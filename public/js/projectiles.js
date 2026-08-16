'use strict';

/**
 * projectiles.js — 投射物（弓箭、塔箭）
 *
 * 弓箭手与城堡箭塔的攻击不再瞬时结算，而是射出实体会飞行的箭矢，
 * 命中后结算伤害，支持掩体与克制/护甲。
 */

RTS.Projectiles = (function () {
  const C = () => RTS.CONFIG;
  const list = [];

  // v13：投射物对象池——回收已消失的箭矢对象，避免频繁 GC
  const pool = [];
  const TRAIL_POOL = []; // trail 数组池

  function getTrail() {
    return TRAIL_POOL.length > 0 ? TRAIL_POOL.pop() : [];
  }
  function recycleTrail(trail) {
    trail.length = 0;
    if (TRAIL_POOL.length < 128) TRAIL_POOL.push(trail);
  }

  function spawn(proj) {
    list.push(proj);
  }

  /** v13：从池中获取或创建投射物对象 */
  function createProj(props) {
    const p = pool.length > 0 ? pool.pop() : {};
    p.x = props.x;
    p.y = props.y;
    p.target = props.target;
    p.speed = props.speed;
    p.damage = props.damage;
    p.attackerType = props.attackerType;
    p.owner = props.owner;
    p.kind = props.kind;
    p.angle = props.angle;
    p.source = props.source || null;
    if (!p.trail) p.trail = getTrail();
    else p.trail.length = 0;
    return p;
  }

  /** 弓箭手射箭（出生即瞄准目标方向） */
  function spawnArrow(unit, target) {
    const sx = unit.x + unit.facingX * unit.radius * 0.6;
    const sy = unit.y - unit.radius * 0.4;
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn(createProj({
      x: sx,
      y: sy,
      target,
      speed: C().arrowSpeed,
      damage: RTS.Resources.effectiveAttack(unit),
      attackerType: unit.type,
      owner: unit.owner,
      kind: 'arrow',
      angle: Math.atan2(ty - sy, tx - sx),
    }));
  }

  /** 城堡角塔射箭：从指定角塔位置朝目标射出 */
  function spawnTowerArrow(base, target, damage, towerIndex) {
    const towers = RTS.World.baseTowerPositions(base);
    const idx = towerIndex !== undefined ? towerIndex : 0;
    const src = towers[idx % towers.length];
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn(createProj({
      x: src.x,
      y: src.y - base.radius * 0.2,
      target,
      speed: C().towerArrowSpeed,
      damage,
      attackerType: 'tower',
      owner: base.owner,
      kind: 'tower',
      angle: Math.atan2(ty - src.y, tx - src.x),
      source: src,
    }));
  }

  /** v9：防御哨塔射箭：从塔顶朝目标射出 */
  function spawnTowerProjectile(tower, target, damage) {
    const sx = tower.x;
    const sy = tower.y - tower.radius * 0.5;
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn(createProj({
      x: sx,
      y: sy,
      target,
      speed: C().towerArrowSpeed,
      damage,
      attackerType: 'tower',
      owner: tower.owner,
      kind: 'tower',
      angle: Math.atan2(ty - sy, tx - sx),
      source: { x: sx, y: sy },
    }));
  }

  /** v13：回收投射物到对象池 */
  function recycleProj(p) {
    if (p.trail) recycleTrail(p.trail);
    p.trail = null;
    p.target = null;
    p.source = null;
    if (pool.length < 256) pool.push(p);
  }

  function update(dt) {
    // v13：使用 swap-and-pop 替代 splice（splice 是 O(n)，大量投射物时开销大）
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const target = p.target;
      if (!target || !target.ref || target.ref.hp <= 0) {
        // swap-and-pop 移除
        recycleProj(p);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }

      const tx = target.ref.x;
      const ty = target.ref.y;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;
      const hitR = target.kind === 'base' || target.kind === 'tower' ? target.ref.radius : target.ref.radius + 4;

      if (dist <= Math.max(step, hitR)) {
        if (target.kind === 'unit') {
          RTS.Combat.applyUnitDamage(p.attackerType, p.damage, target.ref, true);
        } else if (target.kind === 'base') {
          RTS.Combat.hitBase(p.damage, target.ref, RTS.Resources.siegeMul(p.owner));
        } else if (target.kind === 'tower') {
          RTS.Combat.hitTower(p.damage, target.ref);
        } else if (target.kind === 'barracks') {
          RTS.Combat.hitBarracks(p.damage, target.ref);
        }
        recycleProj(p);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }

      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      p.angle = Math.atan2(dy, dx);
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 6) p.trail.shift();
    }
  }

  function clear() {
    for (let i = 0; i < list.length; i++) recycleProj(list[i]);
    list.length = 0;
  }

  return { list, spawnArrow, spawnTowerArrow, spawnTowerProjectile, update, clear };
})();
