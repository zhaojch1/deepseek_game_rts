'use strict';

/**
 * combat.js — 空间分桶、索敌、攻击结算、克制倍率、单位分离
 */

RTS.Combat = (function () {
  const C = () => RTS.CONFIG;
  let cells = new Map();

  function cellKey(cx, cy) {
    return cx + ',' + cy;
  }

  function forEachUnit(fn) {
    const st = RTS.state;
    if (!st) return;
    st.player.units.forEach(fn);
    st.enemy.units.forEach(fn);
  }

  function rebuildHash() {
    cells = new Map();
    const cell = C().spatialCellSize;
    forEachUnit((u) => {
      const cx = Math.floor(u.x / cell);
      const cy = Math.floor(u.y / cell);
      const key = cellKey(cx, cy);
      let arr = cells.get(key);
      if (!arr) {
        arr = [];
        cells.set(key, arr);
      }
      arr.push(u);
    });
  }

  /** 查询以 (x,y) 为圆心、半径 r 内的单位 */
  function query(x, y, r) {
    const cell = C().spatialCellSize;
    const minCx = Math.floor((x - r) / cell);
    const maxCx = Math.floor((x + r) / cell);
    const minCy = Math.floor((y - r) / cell);
    const maxCy = Math.floor((y + r) / cell);
    const out = [];
    const r2 = r * r;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = cells.get(cellKey(cx, cy));
        if (!arr) continue;
        for (const u of arr) {
          const dx = u.x - x;
          const dy = u.y - y;
          if (dx * dx + dy * dy <= r2) out.push(u);
        }
      }
    }
    return out;
  }

  function enemyOf(owner) {
    return owner === 'player' ? 'enemy' : 'player';
  }

  /**
   * 寻找 unit 射程内最近的敌方目标（优先单位，其次基地）。
   * 返回 { kind:'unit'|'base', ref } 或 null。
   */
  function acquire(unit, range) {
    const enemy = enemyOf(unit.owner);
    const enemyFaction = RTS.state[enemy];

    let best = null;
    let bestDist = range * range;

    const units = query(unit.x, unit.y, range + 32);
    for (const u of units) {
      if (u.owner !== enemy || u.hp <= 0) continue;
      const dx = u.x - unit.x;
      const dy = u.y - unit.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = { kind: 'unit', ref: u };
      }
    }

    // 敌方基地（在索敌半径内）
    const base = enemyFaction.base;
    if (base && base.hp > 0) {
      const dx = base.x - unit.x;
      const dy = base.y - unit.y;
      const reach = range + base.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 <= bestDist) {
        best = { kind: 'base', ref: base };
      }
    }

    return best;
  }

  /** 结算一次攻击伤害（含克制倍率） */
  function deliverAttack(unit, target) {
    const st = RTS.state;
    if (target.kind === 'unit') {
      const t = target.ref;
      if (t.hp <= 0) return;
      const mul = RTS.counterMul(unit.type, t.type);
      let dmg = Math.floor(unit.attack * mul);
      if (dmg < 1) dmg = 1;
      RTS.Unit.damage(t, dmg);
      spawnDamageNumber(t.x, t.y, dmg, mul > 1 ? '#ffd24e' : mul < 1 ? '#9fb0c8' : '#ffffff');
    } else if (target.kind === 'base') {
      const base = target.ref;
      if (base.hp <= 0) return;
      const dmg = Math.max(1, Math.floor(unit.attack * C().baseDamageMultiplier));
      base.hp -= dmg;
      spawnDamageNumber(unit.x + (base.x - unit.x) * 0.2, unit.y + (base.y - unit.y) * 0.2, dmg, '#ff8a5a');
      if (base.hp <= 0) {
        base.hp = 0;
        RTS.Match && RTS.Match.checkEnd();
      }
    }
  }

  function spawnDamageNumber(x, y, value, color) {
    if (!RTS.state || !RTS.state.damageNumbers) return;
    RTS.state.damageNumbers.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y - 8,
      value,
      color,
      life: C().damageNumberLifetime,
    });
  }

  /** 单位死亡移除 */
  function kill(unit) {
    const st = RTS.state;
    const faction = st[unit.owner];
    if (faction.units.has(unit.id)) {
      faction.units.delete(unit.id);
    }
    if (unit.owner === 'player' && st.selection) {
      st.selection.delete(unit.id);
    }
  }

  /** 单位间分离（避免堆叠），基于空间分桶 */
  function applySeparation() {
    const sep = C().unitSeparationDist;
    forEachUnit((u) => {
      const neighbors = query(u.x, u.y, sep + 24);
      if (neighbors.length <= 1) return;
      let pushX = 0;
      let pushY = 0;
      for (const n of neighbors) {
        if (n === u) continue;
        const dx = u.x - n.x;
        const dy = u.y - n.y;
        const d = Math.hypot(dx, dy);
        const minD = u.radius + n.radius + 6;
        if (d < sep && d > 0.001) {
          const overlap = sep - d;
          pushX += (dx / d) * overlap;
          pushY += (dy / d) * overlap;
        } else if (d < minD && d > 0.001) {
          const overlap = minD - d;
          pushX += (dx / d) * overlap;
          pushY += (dy / d) * overlap;
        }
      }
      if (pushX || pushY) {
        const nx = u.x + pushX * 0.5;
        const ny = u.y + pushY * 0.5;
        if (RTS.World.isWalkablePx(nx, ny)) {
          u.x = nx;
          u.y = ny;
        }
      }
    });
  }

  /** 飘字老化 */
  function ageDamageNumbers(dt) {
    if (RTS.state && RTS.state.damageNumbers) {
      const arr = RTS.state.damageNumbers;
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].life -= dt;
        arr[i].y -= 18 * dt;
        if (arr[i].life <= 0) arr.splice(i, 1);
      }
    }
  }

  return {
    acquire,
    deliverAttack,
    kill,
    query,
    rebuildHash,
    applySeparation,
    ageDamageNumbers,
    forEachUnit,
  };
})();
