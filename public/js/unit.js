'use strict';

/**
 * unit.js — 单位实体、移动、状态机
 */

RTS.Unit = (function () {
  let nextId = 1;

  function typeStats(type) {
    return RTS.CONFIG.unitTypes[type];
  }

  function create(owner, type, x, y) {
    const s = typeStats(type);
    return {
      id: nextId++,
      owner,
      type,
      x,
      y,
      radius: s.radius,
      hp: s.hp,
      maxHp: s.hp,
      speed: s.speed * RTS.CONFIG.speedScale,
      range: RTS.rangePx(type),
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
      stuckTimer: 0,
      stuckRefX: 0,
      stuckRefY: 0,
      isStuck: false,

      // 动画/渲染辅助
      facingX: owner === 'player' ? 1 : -1,
      flashTimer: 0,
      deathTimer: -1,
    };
  }

  /** 目标是否仍存活 */
  function targetAlive(target) {
    if (!target) return false;
    if (target.kind === 'unit') return target.ref.hp > 0;
    if (target.kind === 'base') return target.ref.hp > 0;
    return false;
  }

  function targetPos(target) {
    return { x: target.ref.x, y: target.ref.y };
  }

  function targetRadius(target) {
    return target.kind === 'unit' ? target.ref.radius : target.ref.radius;
  }

  function distTo(unit, tx, ty) {
    return Math.hypot(tx - unit.x, ty - unit.y);
  }

  /** 朝目标点直线推进（带障碍滑动），返回是否到达 */
  function steerToward(unit, tx, ty, dt) {
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const dist = Math.hypot(dx, dy);
    const step = unit.speed * dt;
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
    return false;
  }

  /** 沿 A* 路径移动（朝最远的可见路点直行，实现平滑转向），返回是否到达终点 */
  function moveAlongPath(unit, dt) {
    if (!unit.orderTarget) return true;

    // 需要重算路径（无路径或卡住超时）
    if (unit.path.length === 0 || unit.repathTimer <= 0) {
      unit.path = RTS.Pathfinding.findPath(unit.x, unit.y, unit.orderTarget.x, unit.orderTarget.y) || [];
      unit.pathIndex = 0;
      unit.repathTimer = RTS.CONFIG.repathInterval;
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

  /** 攻击：在射程内则进入前摇/攻击循环 */
  function engage(unit, target, dt) {
    const d = distTo(unit, target.ref.x, target.ref.y);
    const reach = unit.range + targetRadius(target);
    if (d <= reach) {
      // 面向目标
      unit.facingX = target.ref.x >= unit.x ? 1 : -1;
      if (unit.attackCooldown <= 0 && unit.attackWindup <= 0) {
        unit.attackWindup = RTS.CONFIG.attackWindup;
        unit.attackCooldown = unit.attackInterval;
      }
    } else {
      // 追击
      steerToward(unit, target.ref.x, target.ref.y, dt);
    }
  }

  function update(unit, dt) {
    if (unit.hp <= 0) return;

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
            RTS.Combat.deliverAttack(unit, unit.attackTarget);
          }
        }
      }
    }
    if (unit.flashTimer > 0) unit.flashTimer -= dt;

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
        // 驻守反击：在驻守点附近自动索敌，追出一定范围后归位
        const holdR = Math.max(RTS.CONFIG.acquireRadius, 220);
        const acq = RTS.Combat.acquire(unit, holdR);
        if (acq) {
          unit.attackTarget = acq;
          unit.state = 'attack'; // 追击并攻击
        } else if (Math.hypot(unit.x - unit.holdX, unit.y - unit.holdY) > 20) {
          // 远离驻守点：归位（仅当未被攻击）
          unit.orderTarget = { x: unit.holdX, y: unit.holdY };
          moveAlongPath(unit, dt);
          if (distTo(unit, unit.holdX, unit.holdY) < RTS.CONFIG.arriveThreshold) {
            unit.orderTarget = null;
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
  }

  function damage(unit, amount) {
    unit.hp -= amount;
    unit.flashTimer = 0.12;
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
  };
})();
