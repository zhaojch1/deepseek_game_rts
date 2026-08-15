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

  /** 弓箭手射箭 */
  function spawnArrow(unit, target) {
    spawn({
      x: unit.x + unit.facingX * unit.radius * 0.6,
      y: unit.y - unit.radius * 0.4,
      target,
      speed: C().arrowSpeed,
      damage: RTS.Resources.effectiveAttack(unit),
      attackerType: unit.type,
      owner: unit.owner,
      kind: 'arrow',
      angle: 0,
      trail: [],
    });
  }

  /** 城堡箭塔射箭 */
  function spawnTowerArrow(base, target, damage) {
    const ang = Math.random() * Math.PI * 2;
    spawn({
      x: base.x + Math.cos(ang) * base.radius * 0.4,
      y: base.y - base.radius * 0.35 + Math.sin(ang) * 8,
      target,
      speed: C().towerArrowSpeed,
      damage,
      attackerType: 'tower',
      owner: base.owner,
      kind: 'tower',
      angle: 0,
      trail: [],
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
      const hitR = target.kind === 'base' ? target.ref.radius : target.ref.radius + 4;

      if (dist <= Math.max(step, hitR)) {
        if (target.kind === 'unit') {
          RTS.Combat.applyUnitDamage(p.attackerType, p.damage, target.ref, true);
        } else if (target.kind === 'base') {
          RTS.Combat.hitBase(p.damage, target.ref);
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

  return { list, spawnArrow, spawnTowerArrow, update, clear };
})();
