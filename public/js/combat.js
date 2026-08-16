'use strict';

/**
 * combat.js — 空间分桶、索敌、攻击结算、克制倍率、单位分离
 */

RTS.Combat = (function () {
  const C = () => RTS.CONFIG;
  // v13：复用 Map 和数组，避免每帧 new Map() 触发 GC
  let cells = new Map();
  let cellPool = []; // 退役的数组对象池

  function cellKey(cx, cy) {
    return cx + ',' + cy;
  }

  function forEachUnit(fn) {
    const st = RTS.state;
    if (!st) return;
    st.player.units.forEach(fn);
    st.enemy.units.forEach(fn);
  }

  /** v13：清空 Map 并回收数组到池中（不 new，复用旧数组） */
  function clearCells() {
    cells.forEach((arr) => {
      arr.length = 0;
      cellPool.push(arr);
    });
    cells.clear();
  }

  function rebuildHash() {
    clearCells();
    const cell = C().spatialCellSize;
    forEachUnit((u) => {
      const cx = Math.floor(u.x / cell);
      const cy = Math.floor(u.y / cell);
      const key = cellKey(cx, cy);
      let arr = cells.get(key);
      if (!arr) {
        arr = cellPool.length > 0 ? cellPool.pop() : [];
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

    // 敌方基地（v11：多基地——扫描敌方全部指挥所，取最近者）
    const enemyBases = (enemyFaction.bases && enemyFaction.bases.length) ? enemyFaction.bases : [enemyFaction.base];
    for (const base of enemyBases) {
      if (!base || base.hp <= 0) continue;
      const dx = base.x - unit.x;
      const dy = base.y - unit.y;
      const reach = range + base.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 <= bestDist) {
        bestDist = d2;
        best = { kind: 'base', ref: base };
      }
    }

    // v9：敌方防御哨塔（在索敌半径内，视为建筑目标）
    const towers = (RTS.state && RTS.state.towers) || [];
    for (const t of towers) {
      if (t.owner !== enemy || t.hp <= 0) continue;
      const dx = t.x - unit.x;
      const dy = t.y - unit.y;
      const reach = range + t.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 <= bestDist) {
        bestDist = d2;
        best = { kind: 'tower', ref: t };
      }
    }

    // v10.2：敌方兵营（在索敌半径内，视为建筑目标）
    const barracks = (RTS.state && RTS.state.barracks) || [];
    for (const b of barracks) {
      if (b.owner !== enemy || b.hp <= 0) continue;
      const dx = b.x - unit.x;
      const dy = b.y - unit.y;
      const reach = range + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 <= bestDist) {
        bestDist = d2;
        best = { kind: 'barracks', ref: b };
      }
    }

    return best;
  }

  /** 结算一次单位受到的伤害（克制 + 掩体 + 护甲），返回实际伤害值 */
  function applyUnitDamage(attackerType, attackValue, t, isRanged) {
    if (!t || t.hp <= 0) return 0;
    const mul = RTS.Units.counterMul(attackerType, t.type);
    let dmg = Math.floor(attackValue * mul);
    // 远程攻击者在森林掩体内的单位身上有减伤
    if (isRanged && RTS.World.isCoverPx(t.x, t.y)) {
      dmg = Math.floor(dmg * C().coverRangedMul);
    }
    // 护甲升级：百分比减伤（每级 -pct，最多 5 级）
    const armorLvl = (RTS.state[t.owner].upgrades && RTS.state[t.owner].upgrades.armor) || 0;
    if (armorLvl > 0) dmg = Math.floor(dmg * (1 - armorLvl * C().upgrades.armor.pct));
    if (dmg < 1) dmg = 1;
    RTS.Unit.damage(t, dmg);
    spawnDamageNumber(t.x, t.y, dmg, mul > 1 ? '#ffd24e' : mul < 1 ? '#9fb0c8' : '#ffffff');
    return dmg;
  }

  /** 结算一次对基地的伤害（v8：siegeMul 来自攻击方阵营的「破城技术」等级） */
  function hitBase(attackValue, base, mul) {
    if (!base || base.hp <= 0 || base.destroyed) return 0;
    const dmg = Math.max(1, Math.floor(attackValue * C().baseDamageMultiplier * (mul || 1)));
    base.hp -= dmg;
    spawnDamageNumber(base.x + (Math.random() - 0.5) * 24, base.y - base.radius * 0.5, dmg, '#ff8a5a');
    if (base.hp <= 0) {
      base.hp = 0;
      base.destroyed = true; // v11.1：基地被摧毁——停火/停产出，需建筑师修复重建
      // v11.3：若被摧毁的是该阵营主基地（faction.base），自动切换到第一座存活基地，
      // 让 AI 的集结/撤退/防守锚点与新单位的出生集结点跟随新主基地，不再围在废墟旁
      const fac = RTS.state && RTS.state[base.owner];
      if (fac && fac.base === base) {
        const all = (fac.bases && fac.bases.length) ? fac.bases : [fac.base];
        const alive = all.filter((b) => !b.destroyed && b.hp > 0);
        if (alive.length > 0) fac.base = alive[0];
      }
      RTS.Match && RTS.Match.checkEnd();
    }
    return dmg;
  }

  /** 结算一次对哨塔的伤害（v9：坚固建筑减免，参考基地伤害逻辑） */
  function hitTower(attackValue, tower) {
    if (!tower || tower.hp <= 0) return 0;
    const dmg = Math.max(1, Math.floor(attackValue * C().towerDamageMultiplier));
    tower.hp -= dmg;
    spawnDamageNumber(tower.x + (Math.random() - 0.5) * 20, tower.y - tower.radius * 0.6, dmg, '#ffb020');
    if (tower.hp <= 0) {
      tower.hp = 0;
      if (RTS.Towers) RTS.Towers.destroy(tower);
    }
    return dmg;
  }

  /** v10.2：结算一次对兵营的伤害（坚固建筑减免；摧毁后恢复地形） */
  function hitBarracks(attackValue, barracks) {
    if (!barracks || barracks.hp <= 0) return 0;
    const dmg = Math.max(1, Math.floor(attackValue * C().barracksDamageMultiplier));
    barracks.hp -= dmg;
    spawnDamageNumber(barracks.x + (Math.random() - 0.5) * 22, barracks.y - barracks.radius * 0.6, dmg, '#ff9a5a');
    if (barracks.hp <= 0) {
      barracks.hp = 0;
      if (RTS.Barracks) RTS.Barracks.destroy(barracks);
    }
    return dmg;
  }

  /** 近战/瞬时攻击结算（由单位直接调用） */
  function deliverAttack(unit, target) {
    if (target.kind === 'unit') {
      applyUnitDamage(unit.type, RTS.Resources.effectiveAttack(unit), target.ref, false);
    } else if (target.kind === 'base') {
      // v8：单位定义可带 baseMul（如锤子兵 ×1.5 攻城），叠乘破城科技
      const def = RTS.Units.get(unit.type);
      const baseMul = (def && def.baseMul) || 1;
      hitBase(RTS.Resources.effectiveAttack(unit) * baseMul, target.ref, RTS.Resources.siegeMul(unit.owner));
    } else if (target.kind === 'tower') {
      // v9：攻击哨塔（攻城武器 baseMul 同样生效）
      const def = RTS.Units.get(unit.type);
      const baseMul = (def && def.baseMul) || 1;
      hitTower(RTS.Resources.effectiveAttack(unit) * baseMul, target.ref);
    } else if (target.kind === 'barracks') {
      // v10.2：攻击兵营（攻城武器 baseMul 同样生效）
      const def = RTS.Units.get(unit.type);
      const baseMul = (def && def.baseMul) || 1;
      hitBarracks(RTS.Resources.effectiveAttack(unit) * baseMul, target.ref);
    }
  }

  // v13：飘字数量上限（避免满屏飘字拖慢渲染）
  const MAX_DAMAGE_NUMBERS = 60;

  function spawnDamageNumber(x, y, value, color) {
    if (!RTS.state || !RTS.state.damageNumbers) return;
    // v13：超上限时跳过新飘字（最老的会在 age 中自然消亡）
    if (RTS.state.damageNumbers.length >= MAX_DAMAGE_NUMBERS) return;
    RTS.state.damageNumbers.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y - 8,
      value,
      color,
      life: C().damageNumberLifetime,
    });
  }

  // v13：尸体数量上限（防止长时间对局内存堆积）
  const MAX_CORPSES = 120;

  /** 单位死亡移除（生成尸体供死亡动画渲染） */
  function kill(unit) {
    const st = RTS.state;
    if (st.corpses) {
      // v13：超上限时移除最老的尸体腾位
      if (st.corpses.length >= MAX_CORPSES) {
        st.corpses.shift();
      }
      st.corpses.push({
        x: unit.x,
        y: unit.y,
        type: unit.type,
        owner: unit.owner,
        facingX: unit.facingX,
        radius: unit.radius,
        deathTimer: 1,
      });
    }
    const faction = st[unit.owner];
    if (faction.units.has(unit.id)) {
      faction.units.delete(unit.id);
    }
    if (unit.owner === 'player' && st.selection) {
      st.selection.delete(unit.id);
    }
  }

  /** v13：尸体老化（swap-and-pop 替代 splice） */
  function ageCorpses(dt) {
    if (!RTS.state || !RTS.state.corpses) return;
    const arr = RTS.state.corpses;
    const dur = C().corpseDuration || 0.8;
    for (let i = arr.length - 1; i >= 0; i--) {
      arr[i].deathTimer -= dt / dur;
      if (arr[i].deathTimer <= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
  }

  /**
   * v13：单位间分离（优化版）——先用平方距离快速跳过远邻，减少 Math.hypot 调用。
   * v12：增强版：同阵营斥力更强，不同阵营间保持基础物理分离。
   */
  function applySeparation() {
    const sep = C().unitSeparationDist;
    const sep2 = sep * sep;
    const queryR = sep + 28;
    const friendlyPush = 0.65;
    const enemyPush = 0.35;
    forEachUnit((u) => {
      const neighbors = query(u.x, u.y, queryR);
      if (neighbors.length <= 1) return;
      let pushX = 0;
      let pushY = 0;
      for (let ni = 0; ni < neighbors.length; ni++) {
        const n = neighbors[ni];
        if (n === u) continue;
        const dx = u.x - n.x;
        const dy = u.y - n.y;
        const d2 = dx * dx + dy * dy;
        const minD = u.radius + n.radius + 6;
        const minD2 = minD * minD;
        // v13：先用平方距离判断，只在需要计算推力时才 sqrt
        if (d2 >= sep2 && d2 >= minD2) continue;
        if (d2 < 0.000001) continue;
        const d = Math.sqrt(d2);
        const isFriendly = n.owner === u.owner;
        const pushFactor = isFriendly ? friendlyPush : enemyPush;
        const invD = 1 / d;
        if (d < sep) {
          const overlap = sep - d;
          pushX += dx * invD * overlap * pushFactor;
          pushY += dy * invD * overlap * pushFactor;
        } else if (d < minD) {
          const overlap = minD - d;
          pushX += dx * invD * overlap * pushFactor;
          pushY += dy * invD * overlap * pushFactor;
        }
      }
      if (pushX || pushY) {
        const nx = u.x + pushX;
        const ny = u.y + pushY;
        if (RTS.World.isWalkablePx(nx, ny)) {
          u.x = nx;
          u.y = ny;
        }
      }
    });
  }

  /** v13：飘字老化（swap-and-pop 替代 splice） */
  function ageDamageNumbers(dt) {
    if (RTS.state && RTS.state.damageNumbers) {
      const arr = RTS.state.damageNumbers;
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].life -= dt;
        arr[i].y -= 18 * dt;
        if (arr[i].life <= 0) {
          arr[i] = arr[arr.length - 1];
          arr.pop();
        }
      }
    }
  }

  return {
    acquire,
    deliverAttack,
    applyUnitDamage,
    hitBase,
    hitTower,
    hitBarracks,
    kill,
    ageCorpses,
    query,
    rebuildHash,
    applySeparation,
    ageDamageNumbers,
    forEachUnit,
  };
})();
