'use strict';

/**
 * formations.js — v12 编队系统
 *
 * 解决「黑社会械斗」问题：军队缺乏秩序，兵种混杂堆叠。
 *
 * 核心思路：
 *  1. 单位按角色（近战前排/远程后排/骑兵侧翼）分层定位
 *  2. 移动时编队整体推进，到达后自动展开为战斗队形
 *  3. 编队内强力排斥 + 跨角色额外间距，杜绝兵种堆叠
 *  4. 到达目标时随机错开时机，防止同时挤到一点
 *
 * 架构：RTS.Formations 作为全局编队管理器，挂在 RTS 命名空间。
 */

RTS.Formations = (function () {
  const C = () => RTS.CONFIG;

  // 角色分类缓存（每帧清空重建）
  let roleCache = new Map();

  /**
   * 单位角色分类：melee / ranged / cavalry / special
   * 依据单位定义的 tags 字段判断
   */
  function unitRole(unit) {
    if (roleCache.has(unit.id)) return roleCache.get(unit.id);
    const def = RTS.Units.get(unit.type);
    if (!def) { roleCache.set(unit.id, 'melee'); return 'melee'; }
    const tags = def.tags || [];
    let role;
    if (def.ranged) {
      role = 'ranged';
    } else if (tags.includes('cavalry') || tags.includes('fast')) {
      role = 'cavalry';
    } else if (tags.includes('tank')) {
      role = 'melee'; // 肉盾归入近战前排
    } else if (tags.includes('siege') || tags.includes('support') || unit.type === 'architect') {
      role = 'special';
    } else {
      role = 'melee';
    }
    roleCache.set(unit.id, role);
    return role;
  }

  /**
   * 清空角色缓存（每帧调用一次，确保新建单位的角色正确）
   */
  function clearCache() {
    roleCache.clear();
  }

  /**
   * 计算一组单位的质心（centroid）
   */
  function centroid(units) {
    if (units.length === 0) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const u of units) { sx += u.x; sy += u.y; }
    return { x: sx / units.length, y: sy / units.length };
  }

  /**
   * 计算编队的朝向（从质心指向目标点的方向向量，单位化）。
   * 无目标时默认朝敌方基地方向。
   */
  function facingDir(units, targetX, targetY) {
    const c = centroid(units);
    let dx, dy;
    if (targetX != null && targetY != null) {
      dx = targetX - c.x;
      dy = targetY - c.y;
    } else {
      // 默认朝敌方
      const st = RTS.state;
      const enemy = st && units.length > 0 && units[0].owner === 'player' ? st.enemy.base : (st && st.player.base);
      if (enemy) { dx = enemy.x - c.x; dy = enemy.y - c.y; }
      else { dx = 1; dy = 0; }
    }
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  /**
   * 根据编队角色配置，计算每个单位的理想位置偏移。
   *
   * 布局规则（以编队朝向为「前方」）：
   *  - 近战（melee）：最前方，2 排交错排列。肉盾（tank tag）放第一排中央。
   *  - 骑兵（cavalry）：两翼展开。
   *  - 远程（ranged）：最后方，与近战保持距离。
   *  - 特殊（special）：编队中央偏后（建筑师等）。
   *
   * 返回 Map<unitId, {dx, dy}>，是相对于质心的偏移量（世界坐标）。
   */
  function computeIdealOffsets(units, targetX, targetY) {
    const Cfg = C();
    const spacing = Cfg.formationSepDist;
    const rangedOffset = Cfg.formationRangedOffset;
    const cavalryFlank = Cfg.formationCavalryFlank;
    const dir = facingDir(units, targetX, targetY);
    // 垂直于朝向的「侧向」向量
    const perpX = -dir.y;
    const perpY = dir.x;

    // 按角色分组
    const groups = { melee: [], ranged: [], cavalry: [], special: [] };
    for (const u of units) {
      const r = unitRole(u);
      if (groups[r]) groups[r].push(u);
      else groups.melee.push(u);
    }

    const offsets = new Map();

    // --- 近战前排：2 排交错排列，肉盾放第一排中央 ---
    const melee = groups.melee;
    if (melee.length > 0) {
      // 把肉盾放前面
      const tanks = melee.filter(u => {
        const def = RTS.Units.get(u.type);
        return def && def.tags && def.tags.includes('tank');
      });
      const nonTanks = melee.filter(u => {
        const def = RTS.Units.get(u.type);
        return !(def && def.tags && def.tags.includes('tank'));
      });
      const ordered = tanks.concat(nonTanks);

      const cols1 = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.3)));
      for (let i = 0; i < ordered.length; i++) {
        const row = Math.floor(i / cols1);
        const col = i % cols1;
        const rowWidth = Math.min(ordered.length - row * cols1, cols1);
        // 交错排列：偶数行偏左半个身位
        const stagger = (row % 2 === 1) ? spacing * 0.5 : 0;
        const lateral = (col - (rowWidth - 1) / 2) * spacing + stagger;
        // 前排（row=0）在最前方，后排往后退
        const depth = -row * spacing * 0.85;
        offsets.set(ordered[i].id, {
          dx: perpX * lateral + dir.x * depth,
          dy: perpY * lateral + dir.y * depth,
        });
      }
    }

    // --- 远程后排：整齐一排或两排，与前线保持距离 ---
    const ranged = groups.ranged;
    if (ranged.length > 0) {
      const cols = Math.max(1, Math.ceil(ranged.length / 2));
      for (let i = 0; i < ranged.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const rowWidth = Math.min(ranged.length - row * cols, cols);
        const lateral = (col - (rowWidth - 1) / 2) * spacing;
        const depth = -(rangedOffset + row * spacing * 0.7);
        offsets.set(ranged[i].id, {
          dx: perpX * lateral + dir.x * depth,
          dy: perpY * lateral + dir.y * depth,
        });
      }
    }

    // --- 骑兵侧翼：在编队两侧展开 ---
    const cavalry = groups.cavalry;
    if (cavalry.length > 0) {
      const half = Math.ceil(cavalry.length / 2);
      for (let i = 0; i < cavalry.length; i++) {
        const side = i < half ? 1 : -1; // 右翼 / 左翼
        const idx = i < half ? i : i - half;
        const lateral = side * (cavalryFlank + idx * spacing * 0.7);
        const depth = -idx * spacing * 0.5; // 略微错开，不排成一条线
        offsets.set(cavalry[i].id, {
          dx: perpX * lateral + dir.x * depth,
          dy: perpY * lateral + dir.y * depth,
        });
      }
    }

    // --- 特殊单位：编队中央偏后 ---
    const special = groups.special;
    if (special.length > 0) {
      for (let i = 0; i < special.length; i++) {
        const lateral = (i - (special.length - 1) / 2) * spacing * 0.8;
        const depth = -(rangedOffset * 0.5);
        offsets.set(special[i].id, {
          dx: perpX * lateral + dir.x * depth,
          dy: perpY * lateral + dir.y * depth,
        });
      }
    }

    return offsets;
  }

  /**
   * v12：编队到达随机延迟——给单位一个随机的到达延迟因子，
   * 让编队中的单位错开到达目标点（防止同时抵达堆叠）。
   * 在 orderAttackMove 时调用，将延迟存入 unit.arriveDelay。
   */
  function assignArriveDelay(unit) {
    const Cfg = C();
    unit.arriveDelay = Math.random() * Cfg.formationArriveStagger;
  }

  /**
   * v12：编队感知的攻击移动——对一组单位下达前往目标区域的命令，
   * 按角色分层定位（近战前排/远程后排/骑兵侧翼），并加上到达随机延迟。
   *
   * @param {Array} units - 要命令的单位列表
   * @param {number} targetX - 目标区域中心 X
   * @param {number} targetY - 目标区域中心 Y
   * @param {Object} opts - 可选参数
   *   opts.forceClear: true 时清除微指令
   *   opts.useAttackMove: false 时用 orderMove 代替 orderAttackMove
   *   opts.arriveDelay: true 时启用到达随机延迟
   */
  function formationAttackMove(units, targetX, targetY, opts) {
    opts = opts || {};
    if (units.length === 0) return;

    const offsets = computeIdealOffsets(units, targetX, targetY);
    const Cfg = C();
    const tol = Cfg.formationSpacing * 0.9;

    for (const u of units) {
      if (opts.forceClear) RTS.Unit.clearMicro(u);

      const off = offsets.get(u.id) || { dx: 0, dy: 0 };
      const tx = targetX + off.dx;
      const ty = targetY + off.dy;

      // 去抖：已在途/已到位不重复下令
      if (u.orderTarget && Math.hypot(u.orderTarget.x - tx, u.orderTarget.y - ty) < tol) continue;
      if (Math.hypot(u.x - tx, u.y - ty) < tol) continue;

      if (opts.useAttackMove === false) {
        RTS.Unit.orderMove(u, tx, ty);
      } else {
        RTS.Unit.orderAttackMove(u, tx, ty);
      }

      // 到达随机延迟（防止全部同时抵达）
      if (opts.arriveDelay !== false) {
        assignArriveDelay(u);
      }
    }
  }

  /**
   * v12：编队增强分离力——在 applySeparation 之后额外调用。
   *
   * 与普通分离力的区别：
   *  1. 同角色单位间斥力更大（近战不挤成一团）
   *  2. 不同角色间斥力倍增（远程不能混入近战群）
   *  3. 编队内单位有向理想位置漂移的微力
   */
  function applyFormationSeparation() {
    const st = RTS.state;
    if (!st) return;
    const Cfg = C();
    const sepDist = Cfg.formationSepDist;
    const pushFactor = Cfg.formationSepPush;
    const roleSepMul = Cfg.formationRoleSepMul;

    const allUnits = [];
    st.player.units.forEach(u => { if (u.hp > 0) allUnits.push(u); });
    st.enemy.units.forEach(u => { if (u.hp > 0) allUnits.push(u); });

    for (const u of allUnits) {
      const uRole = unitRole(u);
      const neighbors = RTS.Combat.query(u.x, u.y, sepDist * roleSepMul + 30);
      if (neighbors.length <= 1) continue;

      let pushX = 0, pushY = 0;

      for (const n of neighbors) {
        if (n === u || n.hp <= 0) continue;
        // 只处理同阵营的编队内斥力（敌方间由战斗处理）
        if (n.owner !== u.owner) continue;

        const dx = u.x - n.x;
        const dy = u.y - n.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) continue;

        const nRole = unitRole(n);
        const crossRole = (uRole !== nRole);
        // 不同角色间的斥力更大（保持兵种分层）
        const effectiveSep = crossRole ? sepDist * roleSepMul : sepDist;

        if (d < effectiveSep) {
          const overlap = effectiveSep - d;
          const push = overlap * pushFactor * (crossRole ? 1.4 : 1.0);
          pushX += (dx / d) * push;
          pushY += (dy / d) * push;
        }
      }

      if (pushX !== 0 || pushY !== 0) {
        const nx = u.x + pushX;
        const ny = u.y + pushY;
        if (RTS.World.isWalkablePx(nx, ny)) {
          u.x = nx;
          u.y = ny;
        }
      }
    }
  }

  /**
   * v12：编队凝聚力——空闲单位向编队理想位置漂移。
   * 当单位处于 idle 状态且无微指令时，轻微拉动它到编队中应处的位置，
   * 让基地集结时自动排好阵型，而非随意站位。
   */
  function applyCohesion() {
    const st = RTS.state;
    if (!st) return;
    const Cfg = C();
    const driftSpeed = Cfg.formationIdleDriftSpeed;
    const cohesionR = Cfg.formationCohesionRadius;

    // 对每个阵营分别处理
    for (const owner of ['player', 'enemy']) {
      const faction = st[owner];
      const units = [];
      faction.units.forEach(u => {
        // 只处理空闲、无微指令、非建筑师施工中的单位
        if (u.hp <= 0) return;
        if (u.type === 'architect' && u.building) return;
        if (u.microOrder) return;
        if (u.state !== 'idle') return;
        units.push(u);
      });

      if (units.length < 3) continue; // 单位太少不需要编队

      // 计算编队质心和理想位置
      const c = centroid(units);
      // 朝敌方
      const enemyFaction = st[owner === 'player' ? 'enemy' : 'player'];
      const targetX = enemyFaction.base.x;
      const targetY = enemyFaction.base.y;
      const offsets = computeIdealOffsets(units, targetX, targetY);

      for (const u of units) {
        const off = offsets.get(u.id);
        if (!off) continue;
        const idealX = c.x + off.dx;
        const idealY = c.y + off.dy;
        const dist = Math.hypot(u.x - idealX, u.y - idealY);

        // 只有偏离足够远时才漂移（太近不动，避免抖动）
        if (dist > 15 && dist < cohesionR) {
          const move = Math.min(dist * driftSpeed * 0.016, dist * 0.3); // 每帧最多移动偏离距离的30%
          const nx = u.x + (idealX - u.x) * (move / dist);
          const ny = u.y + (idealY - u.y) * (move / dist);
          if (RTS.World.isWalkablePx(nx, ny)) {
            u.x = nx;
            u.y = ny;
          }
        }
      }
    }
  }

  /**
   * v12：编队速度同步——移动中的编队，让太快的单位减速等后队。
   * 当一组单位在移动（move/attackMove）且目标相近时，
   * 离质心最远的单位被减速，保持编队整体推进。
   *
   * 在 Unit.update 之前调用，临时设置 unit._formationSpeedMul。
   */
  function syncFormationSpeed() {
    const st = RTS.state;
    if (!st) return;
    const Cfg = C();
    const cohesionR = Cfg.formationCohesionRadius;

    for (const owner of ['player', 'enemy']) {
      const faction = st[owner];
      const movingUnits = [];
      faction.units.forEach(u => {
        if (u.hp <= 0) return;
        if (u.state === 'move' || u.state === 'attackMove') {
          // 排除建筑师施工、微指令（斥候抢点等）
          if (u.type === 'architect' && u.building) return;
          if (u.microOrder && (u.microOrder.kind === 'capture' || u.microOrder.kind === 'raid')) return;
          movingUnits.push(u);
        }
      });

      // 按目标位置分组（目标距离 < 200px 的算同一编队）
      const groups = [];
      const assigned = new Set();
      for (const u of movingUnits) {
        if (assigned.has(u.id)) continue;
        if (!u.orderTarget) continue;
        const group = [u];
        assigned.add(u.id);
        for (const v of movingUnits) {
          if (assigned.has(v.id)) continue;
          if (!v.orderTarget) continue;
          if (Math.hypot(u.orderTarget.x - v.orderTarget.x, u.orderTarget.y - v.orderTarget.y) < 200) {
            group.push(v);
            assigned.add(v.id);
          }
        }
        if (group.length >= 3) groups.push(group);
      }

      // 对每个编队组应用速度同步
      for (const group of groups) {
        const c = centroid(group);
        let maxDist = 0;
        for (const u of group) {
          const d = Math.hypot(u.x - c.x, u.y - c.y);
          if (d > maxDist) maxDist = d;
        }

        // 如果编队已经展开太散（有人掉队），让前队减速
        if (maxDist > cohesionR * 0.5) {
          const avgDist = maxDist / 2;
          for (const u of group) {
            const d = Math.hypot(u.x - c.x, u.y - c.y);
            if (d > avgDist * 1.3) {
              // 这个单位在编队前方太远，减速
              u._formationSpeedMul = Math.max(0.55, 1 - (d - avgDist) / cohesionR);
            } else {
              u._formationSpeedMul = 1;
            }
          }
        } else {
          for (const u of group) u._formationSpeedMul = 1;
        }
      }
    }
  }

  return {
    clearCache,
    unitRole,
    centroid,
    facingDir,
    computeIdealOffsets,
    formationAttackMove,
    assignArriveDelay,
    applyFormationSeparation,
    applyCohesion,
    syncFormationSpeed,
  };
})();
