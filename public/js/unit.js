'use strict';

/**
 * unit.js — 单位实体、移动、状态机
 */

RTS.Unit = (function () {
  let nextId = 1;

  function typeStats(type) {
    return RTS.Units.get(type);
  }

  function create(owner, type, x, y) {
    const s = typeStats(type);
    // v8：疾行军科技——新训练单位的移速享受阵营「疾行军」等级加成
    const speedMul = (RTS.Resources && RTS.Resources.unitSpeedMul) ? RTS.Resources.unitSpeedMul(owner) : 1;
    return {
      id: nextId++,
      owner,
      type,
      x,
      y,
      radius: s.radius,
      hp: s.hp,
      maxHp: s.hp,
      speed: s.speed * RTS.CONFIG.speedScale * speedMul,
      range: RTS.Units.rangePx(type),
      attack: s.attack,
      attackInterval: s.attackInterval,
      ranged: !!s.ranged,

      state: 'idle', // idle | move | attack | attackMove
      path: [],
      pathIndex: 0,
      orderTarget: null, // {x,y} 移动目的地（move/attackMove 的目标）
      holdX: x, // 驻守点：idle/到达后自动反击的锚点，追出后归位
      holdY: y,
      attackTarget: null, // {kind:'unit'|'base', ref, id} 当前攻击目标
      attackCooldown: 0,
      attackWindup: 0,
      repathTimer: 0,
      pathGoalX: null, // 当前 path 计算时对应的目标（用于检测目标变化强制重算）
      pathGoalY: null,
      stuckTimer: 0,
      stuckRefX: 0,
      stuckRefY: 0,
      isStuck: false,

      // 动画/渲染辅助
      facingX: owner === 'player' ? 1 : -1,
      flashTimer: 0,
      deathTimer: -1,
      animPhase: Math.random() * Math.PI * 2, // 行走动画相位
      attackAnim: 0, // 攻击挥击/拉弓后摇计时
      aimAngle: 0, // 远程单位瞄准目标的上仰/下俯角（弧度）

      // v10：微指令（逐单位战术指令）——{ kind, x, y, radius, nodeId, waypoints, wpIndex,
      //      until, source }。有微指令的单位被 AI 标记为「已占用」，
      //     普通态势执行器不得再对其下令（防止来回拉扯）。
      microOrder: null,

      // v11：最近一次受到伤害的时间（秒，RTS.state.time）。斥候用它判断
      // 「被攻击时才反击」——窗口内允许交战，窗口外不主动索敌。
      lastHurtAt: -9999,

      // v12：编队到达随机延迟因子（0-1），formations.js 在下达编队移动时设置，
      //     steerToward 用它临时降低移速，让编队中的单位错开到达（防止同时堆叠）。
      arriveDelay: 0,
      _formationSpeedMul: 1, // v12：编队速度同步乘数（formations.js 设置）
    };
  }

  /** v10：清除单位的微指令（玩家手动下令 / 指令超期时调用） */
  function clearMicro(unit) {
    unit.microOrder = null;
  }

  /** v10：单位当前是否有未过期的微指令 */
  function microActive(unit) {
    const m = unit.microOrder;
    if (!m) return false;
    if (m.until != null && RTS.state && RTS.state.time > m.until) return false;
    return true;
  }

  /**
   * v11：斥候「不主动交战」判定——正在抢占资源点（capture 微指令）的斥候，
   * 除非刚被攻击（lastHurtAt 在 aiScoutCounterattackWindow 内），否则不索敌、
   * 不交战，优先奔赴下一个据点（斥候移速全场最快，遇敌可直接甩开）。
   */
  function scoutPassive(unit) {
    if (unit.type !== 'scout' || !unit.microOrder || unit.microOrder.kind !== 'capture') return false;
    const st = RTS.state;
    if (!st) return true;
    const window = (RTS.CONFIG.aiScoutCounterattackWindow != null)
      ? RTS.CONFIG.aiScoutCounterattackWindow : 3;
    return (st.time - (unit.lastHurtAt || -9999)) > window;
  }

  /** 目标是否仍存活 */
  function targetAlive(target) {
    if (!target) return false;
    if (target.kind === 'unit') return target.ref.hp > 0;
    if (target.kind === 'base') return target.ref.hp > 0;
    if (target.kind === 'tower') return target.ref.hp > 0;
    if (target.kind === 'barracks') return target.ref.hp > 0; // v10.2
    return false;
  }

  function targetPos(target) {
    return { x: target.ref.x, y: target.ref.y };
  }

  function targetRadius(target) {
    return target.ref.radius;
  }

  function distTo(unit, tx, ty) {
    return Math.hypot(tx - unit.x, ty - unit.y);
  }

  /** 朝目标点直线推进（带障碍滑动），返回是否到达 */
  function steerToward(unit, tx, ty, dt) {
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const dist = Math.hypot(dx, dy);
    // v12：编队速度同步——_formationSpeedMul 由 formations.js 设置，让前队减速等后队
    const speedMul = unit._formationSpeedMul || 1;
    const step = unit.speed * speedMul * dt;
    if (dist <= step || dist < 0.001) {
      unit.x = tx;
      unit.y = ty;
      return true;
    }
    const nx = unit.x + (dx / dist) * step;
    const ny = unit.y + (dy / dist) * step;
    if (RTS.World.isWalkablePx(nx, ny)) {
      unit.x = nx;
      unit.y = ny;
    } else if (RTS.World.isWalkablePx(nx, unit.y)) {
      unit.x = nx;
    } else if (RTS.World.isWalkablePx(unit.x, ny)) {
      unit.y = ny;
    }
    if (Math.abs(dx) > 0.01) unit.facingX = dx >= 0 ? 1 : -1;
    return false;
  }

  /** 沿 A* 路径移动到 (tx,ty)（朝最远的可见路点直行，实现平滑转向），返回是否到达终点 */
  function followPath(unit, tx, ty, dt) {
    // 目标显著变化（例如从追击目标切回移动目标）→ 立即重算
    if (
      unit.pathGoalX == null ||
      Math.hypot(unit.pathGoalX - tx, unit.pathGoalY - ty) > RTS.CONFIG.repathTargetDelta
    ) {
      unit.repathTimer = 0;
    }

    // 需要重算路径（无路径 / 卡住超时 / 目标变化）
    if (unit.path.length === 0 || unit.repathTimer <= 0) {
      unit.path = RTS.Pathfinding.findPath(unit.x, unit.y, tx, ty) || [];
      unit.pathIndex = 0;
      unit.repathTimer = RTS.CONFIG.repathInterval;
      unit.pathGoalX = tx;
      unit.pathGoalY = ty;
      if (unit.path.length === 0) return false;
    }

    // 从远到近找「前瞻距离内」最远的视线可达路点，直行过去（平滑转向 + 限制采样成本）
    const lookahead = RTS.CONFIG.pathLookahead;
    let targetIdx = -1;
    for (let i = unit.path.length - 1; i >= unit.pathIndex; i--) {
      const wp = unit.path[i];
      if (distTo(unit, wp.x, wp.y) > lookahead) continue; // 超出前瞻距离，跳过
      if (RTS.Pathfinding.hasLineOfSight(unit.x, unit.y, wp.x, wp.y)) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) {
      // 理论上不会发生：取当前最近路点兜底
      targetIdx = Math.min(unit.pathIndex, unit.path.length - 1);
    }

    const targetWp = unit.path[targetIdx];
    const d = distTo(unit, targetWp.x, targetWp.y);

    // 已到达该路点 → 前进到下一段
    if (d < RTS.CONFIG.arriveThreshold) {
      unit.pathIndex = targetIdx + 1;
      return targetIdx >= unit.path.length - 1; // 是否到达终点
    }

    steerToward(unit, targetWp.x, targetWp.y, dt);

    // 周期性重算
    unit.repathTimer -= dt;

    // 净位移卡住检测（0.5s 窗口，避免被分离力的来回震荡掩盖）
    unit.stuckTimer += dt;
    if (unit.stuckTimer >= 0.5) {
      const net = Math.hypot(unit.x - unit.stuckRefX, unit.y - unit.stuckRefY);
      if (net < unit.speed * 0.5 * 0.25) {
        unit.isStuck = true;
        unit.repathTimer = 0;
      } else {
        unit.isStuck = false;
        unit.stuckTimer = 0;
      }
      unit.stuckRefX = unit.x;
      unit.stuckRefY = unit.y;
    }
    return false;
  }

  /** 沿 A* 路径移动（move/attackMove 使用），返回是否到达终点 */
  function moveAlongPath(unit, dt) {
    if (!unit.orderTarget) return true;
    return followPath(unit, unit.orderTarget.x, unit.orderTarget.y, dt);
  }

  /**
   * 朝 (tx,ty) 推进：目标直线可达则直接逼近，否则 A* 绕行。
   * 用于追击/攻击跨越河流、山脉等障碍的目标（避免卡在障碍边缘）。
   */
  function seekToward(unit, tx, ty, dt) {
    if (RTS.Pathfinding.hasLineOfSight(unit.x, unit.y, tx, ty)) {
      return steerToward(unit, tx, ty, dt);
    }
    followPath(unit, tx, ty, dt);
    return false;
  }

  /**
   * v12：风筝后退——远程单位背对目标移动（保持距离，边退边射）。
   * speedMul 控制后退速度：步兵 0.55，骑射 0.75（马上射箭更快）。
   */
  function kiteAway(unit, target, dt, speedMul) {
    const dx = unit.x - target.ref.x;
    const dy = unit.y - target.ref.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = unit.speed * (speedMul || 0.55) * dt;
    const nx = unit.x + (dx / d) * step;
    const ny = unit.y + (dy / d) * step;
    if (RTS.World.isWalkablePx(nx, ny)) {
      unit.x = nx;
      unit.y = ny;
    } else {
      // 碰墙时尝试横向滑动（沿着障碍物边缘继续后退，不卡住）
      const perpX = -dy / d;
      const perpY = dx / d;
      for (const sign of [1, -1]) {
        const sx = unit.x + perpX * step * sign;
        const sy = unit.y + perpY * step * sign;
        if (RTS.World.isWalkablePx(sx, sy)) {
          unit.x = sx;
          unit.y = sy;
          break;
        }
      }
    }
    // 后退时仍保持面向目标
    unit.facingX = target.ref.x >= unit.x ? 1 : -1;
  }

  /**
   * v12：寻找对远程单位威胁最大的近战敌人（最近的非远程敌方单位）。
   * 用于判断是否需要自动风筝/撤退。
   */
  function nearestMeleeThreat(unit, range) {
    const enemy = unit.owner === 'player' ? 'enemy' : 'player';
    const neighbors = RTS.Combat.query(unit.x, unit.y, range);
    let best = null;
    let bestDist = range * range;
    for (const u of neighbors) {
      if (u.owner !== enemy || u.hp <= 0) continue;
      const def = RTS.Units.get(u.type);
      if (!def || def.ranged) continue; // 只关心近战威胁
      const dx = u.x - unit.x;
      const dy = u.y - unit.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = u;
      }
    }
    return best;
  }

  /**
   * v12：统计远程单位「前方」的友方近战数量。
   * 「前方」= 朝敌方基地方向的半圆区域。
   * 用来判断远程单位是否有近战掩护，决定是否需要主动后退。
   */
  function countFriendlyMeleeAhead(unit, range) {
    const st = RTS.state;
    if (!st) return 0;
    // 确定「前方」方向：朝敌方基地
    const enemyFaction = st[unit.owner === 'player' ? 'enemy' : 'player'];
    const dirX = enemyFaction.base.x - unit.x;
    const dirY = enemyFaction.base.y - unit.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    const ndx = dirX / dirLen;
    const ndy = dirY / dirLen;

    const neighbors = RTS.Combat.query(unit.x, unit.y, range);
    let count = 0;
    for (const u of neighbors) {
      if (u.owner !== unit.owner || u.hp <= 0 || u === unit) continue;
      const def = RTS.Units.get(u.type);
      if (!def || def.ranged) continue; // 只统计友方近战
      // 检查是否在前方半圆（dot product > 0）
      const dx = u.x - unit.x;
      const dy = u.y - unit.y;
      const dot = dx * ndx + dy * ndy;
      if (dot > 0) count++;
    }
    return count;
  }

  /** 攻击：在射程内则进入前摇/攻击循环 */
  function engage(unit, target, dt) {
    const d = distTo(unit, target.ref.x, target.ref.y);
    const reach = unit.range + targetRadius(target);
    if (d <= reach) {
      // v12：远程自动风筝——所有远程单位（弓箭手/弩手/骑射手）自动对近战敌人保持距离。
      // 逻辑：检测射程内是否有近战威胁 → 有则边退边射（骑射退得更快）。
      if (unit.ranged && target.kind === 'unit' && target.ref.type) {
        const targetDef = RTS.Units.get(target.ref.type);
        const targetIsRanged = targetDef && targetDef.ranged;
        const Cfg = RTS.CONFIG;

        if (!targetIsRanged) {
          // 当前目标就是近战 → 直接对其风筝
          const kiteMul = unit.speed > 200 // 骑射（speed 经过 speedScale 后 > 200）
            ? (Cfg.autoKiteSpeedMulCav || 0.75)
            : (Cfg.autoKiteSpeedMul || 0.55);
          const triggerDist = (unit.range + targetRadius(target)) * (Cfg.autoKiteRangeMul || 0.50);
          if (d < triggerDist) {
            kiteAway(unit, target, dt, kiteMul);
          }
        } else {
          // 当前目标是远程，但附近可能有近战冲过来 → 检测最近的近战威胁
          const meleeThreat = nearestMeleeThreat(unit, unit.range * 0.8);
          if (meleeThreat) {
            const threatDist = Math.hypot(meleeThreat.x - unit.x, meleeThreat.y - unit.y);
            const triggerDist = unit.range * (Cfg.autoKiteRangeMul || 0.50);
            if (threatDist < triggerDist) {
              const kiteMul = unit.speed > 200
                ? (Cfg.autoKiteSpeedMulCav || 0.75)
                : (Cfg.autoKiteSpeedMul || 0.55);
              kiteAway(unit, { kind: 'unit', ref: meleeThreat }, dt, kiteMul);
            }
          }
        }
      }
      // v10：原有风筝微指令（AI 手动下达的 kite 指令，保留兼容）
      if (
        unit.ranged &&
        unit.microOrder && unit.microOrder.kind === 'kite' &&
        target.kind === 'unit' && target.ref.type &&
        !(RTS.Units.get(target.ref.type) || {}).ranged &&
        d < unit.range * RTS.CONFIG.aiKiteDistanceMul
      ) {
        kiteAway(unit, target, dt, 0.55);
      }
      // 面向目标
      unit.facingX = target.ref.x >= unit.x ? 1 : -1;
      // 远程单位：记录朝目标的上仰/下俯角，用于渲染瞄准
      if (unit.ranged) {
        const dx = Math.abs(target.ref.x - unit.x) || 1;
        const dy = target.ref.y - unit.y;
        unit.aimAngle = Math.max(-0.9, Math.min(0.9, Math.atan2(dy, dx)));
      }
      if (unit.attackCooldown <= 0 && unit.attackWindup <= 0) {
        unit.attackWindup = RTS.CONFIG.attackWindup;
        unit.attackCooldown = unit.attackInterval;
      }
    } else {
      // 追击：有视线则直追，跨障碍则 A* 绕行
      seekToward(unit, target.ref.x, target.ref.y, dt);
    }
  }

  function update(unit, dt) {
    if (unit.hp <= 0) return;

    // v9：建筑师施工中——只前往建造点，抵达后原地站定，不参与战斗/索敌
    // v11.1：base_repair（修复被摧毁基地）也走同一状态机（spot.radius 区分到达判定）
    if (unit.type === 'architect' && unit.building) {
      const spot = unit.building;
      const buildR = (spot.radius != null ? spot.radius : RTS.CONFIG.towerBuildRadius) + 8;
      if (Math.hypot(unit.x - spot.x, unit.y - spot.y) > buildR) {
        if (!unit.orderTarget) RTS.Unit.orderMove(unit, spot.x, spot.y);
        else moveAlongPath(unit, dt);
      } else {
        unit.state = 'idle';
        unit.orderTarget = null;
        unit.path = [];
        unit.pathIndex = 0;
      }
      if (unit.attackAnim > 0) unit.attackAnim = Math.max(0, unit.attackAnim - dt);
      if (unit.flashTimer > 0) unit.flashTimer -= dt;
      unit.animPhase += dt * 0.9; // 施工敲打动画
      return;
    }

    // v10：微指令超期自动失效（占用标记解除，恢复常规行动）
    if (unit.microOrder && unit.microOrder.until != null && RTS.state && RTS.state.time > unit.microOrder.until) {
      unit.microOrder = null;
    }

    if (unit.attackCooldown > 0) unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    if (unit.attackWindup > 0) {
      unit.attackWindup -= dt;
      if (unit.attackWindup <= 0) {
        unit.attackWindup = 0;
        // 前摇结束，若目标仍在射程内则结算
        if (unit.attackTarget && targetAlive(unit.attackTarget)) {
          const d = distTo(unit, unit.attackTarget.ref.x, unit.attackTarget.ref.y);
          const reach = unit.range + targetRadius(unit.attackTarget) + 8; // 8px 容错
          if (d <= reach) {
            if (unit.ranged) {
              // 弓箭手：射出实体箭矢
              RTS.Projectiles.spawnArrow(unit, unit.attackTarget);
            } else {
              // 近战：立即结算 + 挥击动画
              RTS.Combat.deliverAttack(unit, unit.attackTarget);
            }
            unit.attackAnim = 0.22;
          }
        }
      }
    }
    if (unit.attackAnim > 0) unit.attackAnim = Math.max(0, unit.attackAnim - dt);
    if (unit.flashTimer > 0) unit.flashTimer -= dt;

    // 行走动画相位推进
    if (unit.state === 'move' || unit.state === 'attackMove' || unit.state === 'attack') {
      unit.animPhase += dt * unit.speed * 0.22;
    }

    const target = unit.attackTarget && targetAlive(unit.attackTarget) ? unit.attackTarget : null;
    if (!target) unit.attackTarget = null;

    switch (unit.state) {
      case 'attack': {
        if (target) {
          engage(unit, target, dt);
        } else {
          unit.attackTarget = null;
          unit.state = 'idle';
        }
        break;
      }
      case 'attackMove': {
        if (target) {
          engage(unit, target, dt);
        } else {
          // v11：抢占资源中的斥候不主动交战（除非刚被攻击），直奔目标点
          if (!scoutPassive(unit)) {
            const acq = RTS.Combat.acquire(unit, RTS.CONFIG.attackMoveAcquireRadius);
            if (acq) {
              unit.attackTarget = acq;
            } else {
              const arrived = moveAlongPath(unit, dt);
              if (arrived) {
                // 到达攻击移动目的地：落位驻守，转为 idle 并在原地自动反击
                unit.holdX = unit.x;
                unit.holdY = unit.y;
                unit.state = 'idle';
                unit.isStuck = false;
                unit.stuckTimer = 0;
              }
              // 移动中亦会就近自动攻击（在射程内）
              const nearby = RTS.Combat.acquire(unit, unit.range);
              if (nearby) unit.attackTarget = nearby;
            }
          } else {
            const arrived = moveAlongPath(unit, dt);
            if (arrived) {
              unit.holdX = unit.x;
              unit.holdY = unit.y;
              unit.state = 'idle';
              unit.isStuck = false;
              unit.stuckTimer = 0;
            }
          }
        }
        break;
      }
      case 'move': {
        // 右键移动 = 无条件前进，途中不自动索敌，保证随时可改向/掉头
        const arrived = moveAlongPath(unit, dt);
        if (arrived) {
          unit.holdX = unit.x;
          unit.holdY = unit.y;
          unit.state = 'idle';
          unit.isStuck = false;
          unit.stuckTimer = 0;
        } else if (unit.isStuck) {
          // 被敌人卡住无法前进时，清障后继续前往原目的地（不丢失移动指令）
          const blocker = RTS.Combat.acquire(unit, unit.range + 30);
          if (blocker) {
            unit.attackTarget = blocker;
            unit.state = 'attackMove';
            unit.isStuck = false;
            unit.stuckTimer = 0;
          }
        }
        break;
      }
      case 'idle':
      default: {
        // v10：巡逻微指令——按路点循环移动（途中自动索敌），到达当前路点后推进到下一个
        if (unit.microOrder && unit.microOrder.kind === 'patrol' && unit.microOrder.waypoints && unit.microOrder.waypoints.length > 0) {
          const wp = unit.microOrder.waypoints;
          let idx = unit.microOrder.wpIndex || 0;
          if (Math.hypot(unit.x - wp[idx].x, unit.y - wp[idx].y) < RTS.CONFIG.arriveThreshold * 2) {
            idx = (idx + 1) % wp.length;
            unit.microOrder.wpIndex = idx;
          }
          const next = wp[idx];
          if (!unit.orderTarget || Math.hypot(unit.orderTarget.x - next.x, unit.orderTarget.y - next.y) > RTS.CONFIG.repathTargetDelta) {
            RTS.Unit.orderAttackMove(unit, next.x, next.y);
          }
          break;
        }

        // 驻守反击：在驻守点附近自动索敌，追出一定范围后归位
        // v11：抢占资源中的斥候不主动交战（除非刚被攻击），在据点周围安静驻守
        const holdR = Math.max(RTS.CONFIG.acquireRadius, 220);
        const acq = scoutPassive(unit) ? null : RTS.Combat.acquire(unit, holdR);
        if (acq) {
          // v12：远程单位在攻击前先检查是否需要主动撤退——
          // 如果最近的近战敌人很近且前方没有友方近战掩护，先退到安全位置再射击。
          if (unit.ranged && acq.kind === 'unit' && acq.ref.type) {
            const acqDef = RTS.Units.get(acq.ref.type);
            const acqIsMelee = acqDef && !acqDef.ranged;
            if (acqIsMelee) {
              const enemyDist = Math.hypot(acq.ref.x - unit.x, acq.ref.y - unit.y);
              const dangerZone = unit.range * (RTS.CONFIG.autoKiteRangeMul || 0.50) * 1.4;
              if (enemyDist < dangerZone) {
                // 检查前方是否有友方近战可以扛线
                const friendlyMelee = countFriendlyMeleeAhead(unit, unit.range * 0.8);
                if (friendlyMelee === 0) {
                  // 没有掩护，主动后退到 holdX/holdY（编队给的理想位置）
                  const retreatDist = Math.hypot(unit.x - unit.holdX, unit.y - unit.holdY);
                  if (retreatDist > RTS.CONFIG.arriveThreshold) {
                    unit.orderTarget = { x: unit.holdX, y: unit.holdY };
                    moveAlongPath(unit, dt);
                    break; // 本帧不攻击，先走
                  }
                }
              }
            }
          }
          unit.attackTarget = acq;
          unit.state = 'attack'; // 追击并攻击（跨障碍时 seekToward 会 A* 绕行）
          unit.path = [];
          unit.pathIndex = 0;
          unit.pathGoalX = null;
          unit.pathGoalY = null;
        } else {
          // v10：微指令驻守（抢占资源/驻守点位）时用微指令半径作为归位阈值，
          // 保证单位守在节点/点位附近而不乱跑
          const mo = unit.microOrder;
          const isHoldOrder = mo && (mo.kind === 'capture' || mo.kind === 'hold' || mo.kind === 'defend' || mo.kind === 'intercept');
          const returnR = isHoldOrder ? (mo.radius || RTS.CONFIG.aiMicroHoldRadius) : 20;
          if (Math.hypot(unit.x - unit.holdX, unit.y - unit.holdY) > returnR) {
            // 远离驻守点：归位（仅当未被攻击）
            unit.orderTarget = { x: unit.holdX, y: unit.holdY };
            moveAlongPath(unit, dt);
            if (distTo(unit, unit.holdX, unit.holdY) < RTS.CONFIG.arriveThreshold) {
              unit.orderTarget = null;
            }
          }
        }
        break;
      }
    }
  }

  /** 下达移动指令（A* 寻路） */
  function orderMove(unit, x, y) {
    unit.orderTarget = RTS.World.nearestWalkablePx(x, y);
    unit.state = 'move';
    unit.attackTarget = null;
    unit.path = RTS.Pathfinding.findPath(unit.x, unit.y, unit.orderTarget.x, unit.orderTarget.y) || [];
    unit.pathIndex = 0;
    unit.repathTimer = RTS.CONFIG.repathInterval;
    unit.pathGoalX = unit.orderTarget.x;
    unit.pathGoalY = unit.orderTarget.y;
    unit.stuckTimer = 0;
    unit.stuckRefX = unit.x;
    unit.stuckRefY = unit.y;
    unit.isStuck = false;
    unit.holdX = unit.orderTarget.x;
    unit.holdY = unit.orderTarget.y;
  }

  function orderAttackMove(unit, x, y) {
    unit.orderTarget = RTS.World.nearestWalkablePx(x, y);
    unit.state = 'attackMove';
    unit.attackTarget = null;
    unit.path = RTS.Pathfinding.findPath(unit.x, unit.y, unit.orderTarget.x, unit.orderTarget.y) || [];
    unit.pathIndex = 0;
    unit.repathTimer = RTS.CONFIG.repathInterval;
    unit.pathGoalX = unit.orderTarget.x;
    unit.pathGoalY = unit.orderTarget.y;
    unit.stuckTimer = 0;
    unit.stuckRefX = unit.x;
    unit.stuckRefY = unit.y;
    unit.isStuck = false;
    unit.holdX = unit.orderTarget.x;
    unit.holdY = unit.orderTarget.y;
  }

  function orderAttack(unit, target) {
    unit.attackTarget = target;
    unit.state = 'attack';
    unit.orderTarget = null;
    // 清空旧移动路径，让追击按目标重新 A* 绕行
    unit.path = [];
    unit.pathIndex = 0;
    unit.pathGoalX = null;
    unit.pathGoalY = null;
  }

  function damage(unit, amount) {
    unit.hp -= amount;
    unit.flashTimer = 0.12;
    // v11：记录受击时间（斥候「被攻击时才反击」的依据）
    unit.lastHurtAt = (RTS.state && RTS.state.time) || 0;
    if (unit.hp <= 0) {
      unit.hp = 0;
      RTS.Combat.kill(unit);
    }
  }

  return {
    create,
    update,
    orderMove,
    orderAttackMove,
    orderAttack,
    damage,
    typeStats,
    targetAlive,
    distTo,
    clearMicro,
    microActive,
  };
})();
