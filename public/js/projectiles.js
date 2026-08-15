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

  function spawn(proj) {
    list.push(proj);
  }

  /** 弓箭手射箭（出生即瞄准目标方向） */
  function spawnArrow(unit, target) {
    const sx = unit.x + unit.facingX * unit.radius * 0.6;
    const sy = unit.y - unit.radius * 0.4;
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn({
      x: sx,
      y: sy,
      target,
      speed: C().arrowSpeed,
      damage: RTS.Resources.effectiveAttack(unit),
      attackerType: unit.type,
      owner: unit.owner,
      kind: 'arrow',
      angle: Math.atan2(ty - sy, tx - sx),
      trail: [],
    });
  }

  /** 城堡角塔射箭：从指定角塔位置朝目标射出 */
  function spawnTowerArrow(base, target, damage, towerIndex) {
    const towers = RTS.World.baseTowerPositions(base);
    const idx = towerIndex !== undefined ? towerIndex : 0;
    const src = towers[idx % towers.length];
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn({
      x: src.x,
      y: src.y - base.radius * 0.2,
      target,
      speed: C().towerArrowSpeed,
      damage,
      attackerType: 'tower',
      owner: base.owner,
      kind: 'tower',
      angle: Math.atan2(ty - src.y, tx - src.x),
      trail: [],
      source: src, // 用于渲染发射轨迹
    });
  }

  /** v9：防御哨塔射箭：从塔顶朝目标射出 */
  function spawnTowerProjectile(tower, target, damage) {
    const sx = tower.x;
    const sy = tower.y - tower.radius * 0.5;
    const tx = target.ref.x;
    const ty = target.ref.y;
    spawn({
      x: sx,
      y: sy,
      target,
      speed: C().towerArrowSpeed,
      damage,
      attackerType: 'tower',
      owner: tower.owner,
      kind: 'tower',
      angle: Math.atan2(ty - sy, tx - sx),
      trail: [],
      source: { x: sx, y: sy }, // 用于渲染发射轨迹
    });
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const target = p.target;
      if (!target || !target.ref) {
        list.splice(i, 1);
        continue;
      }
      // 目标已死亡则箭矢落空消失
      if (target.ref.hp <= 0) {
        list.splice(i, 1);
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
        }
        list.splice(i, 1);
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
    list.length = 0;
  }

  return { list, spawnArrow, spawnTowerArrow, spawnTowerProjectile, update, clear };
})();
