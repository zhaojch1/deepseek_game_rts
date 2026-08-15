'use strict';

/**
 * ai.js — 敌方 AI：规则层（保底）+ DeepSeek 指挥官层（增强，失败自动降级）
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  function countArmy(faction) {
    const counts = { spear: 0, sword: 0, archer: 0, cavalry: 0, total: 0 };
    faction.units.forEach((u) => {
      counts[u.type]++;
      counts.total++;
    });
    return counts;
  }

  /** 克制某兵种的生产选择 */
  function counterOf(type) {
    switch (type) {
      case 'spear':
        return 'sword';
      case 'sword':
        return 'cavalry';
      case 'archer':
        return 'cavalry';
      case 'cavalry':
        return 'spear';
      default:
        return 'sword';
    }
  }

  function init() {
    const Cfg = C();
    return {
      productionTimer: 0,
      productionInterval: 1.5,
      nextAttackTime: Cfg.aiFirstAttackTime,
      attackInProgress: false,
      attackWaveEndTime: 0,
      defenseTimer: 0,
      deepseekNextAt: Cfg.aiDecisionIntervalMax,
      deepseekBusy: false,
      deepseekActive: false,
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
        attackNow: false,
      },
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,
    };
  }

  function decideProductionType(ai, playerArmy) {
    const weights = { spear: 1, sword: 1, archer: 1, cavalry: 1 };
    // 找到玩家数量最多的兵种并反制
    let dominant = 'spear';
    let max = -1;
    for (const t of ['spear', 'sword', 'archer', 'cavalry']) {
      if (playerArmy[t] > max) {
        max = playerArmy[t];
        dominant = t;
      }
    }
    weights[counterOf(dominant)] += 4;
    // DeepSeek 指挥官倾向
    if (ai.strategy.armyFocus) {
      weights[ai.strategy.armyFocus] += 3;
    }
    // 少量随机扰动，避免过于死板
    const types = Object.keys(weights);
    const totalW = types.reduce((s, t) => s + weights[t], 0);
    let r = Math.random() * totalW;
    for (const t of types) {
      r -= weights[t];
      if (r <= 0) return t;
    }
    return 'sword';
  }

  function produce(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const playerArmy = countArmy(st.player);
    const type = decideProductionType(ai, playerArmy);
    // 连续下单直到军费不够或达到排队上限
    let guard = 0;
    while (guard++ < 6) {
      const check = RTS.Production.canOrder(enemy, type);
      if (!check.ok) break;
      RTS.Production.order(enemy, type);
    }
  }

  function launchAttack(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const target = st.player.base;
    let ordered = 0;
    const strikeCap = Math.floor(enemy.units.size * 0.75) || 1;
    enemy.units.forEach((u) => {
      if (ordered >= strikeCap) return;
      if (u.state === 'idle' || u.state === 'move') {
        // 编队：围绕目标点小范围散布
        const ang = (ordered / Math.max(1, strikeCap)) * Math.PI * 2;
        const spread = Math.min(120, 40 + strikeCap * 2);
        const ox = target.x + Math.cos(ang) * spread;
        const oy = target.y + Math.sin(ang) * spread;
        RTS.Unit.orderAttackMove(u, ox, oy);
        ordered++;
      }
    });
    if (ordered > 0) {
      ai.attackInProgress = true;
      ai.attackWaveEndTime = RTS.state.time + 22; // 攻击波持续约 22s
    }
  }

  function checkDefense(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const base = enemy.base;
    const radius = C().aiDefenseRadius;
    let intruders = 0;
    st.player.units.forEach((u) => {
      if (RTS.Unit.distTo(u, base.x, base.y) < radius) intruders++;
    });
    if (intruders >= 3) {
      // 回防：命令基地附近空闲单位迎击入侵者
      enemy.units.forEach((u) => {
        if (u.state !== 'idle') return;
        if (RTS.Unit.distTo(u, base.x, base.y) < radius * 2) {
          // 攻击最近入侵者
          let nearest = null;
          let nd = Infinity;
          st.player.units.forEach((p) => {
            const d = RTS.Unit.distTo(u, p.x, p.y);
            if (d < nd) {
              nd = d;
              nearest = p;
            }
          });
          if (nearest) RTS.Unit.orderAttack(u, { kind: 'unit', ref: nearest });
        }
      });
    }
  }

  /** DeepSeek 指挥官：每 20-30s 异步请求一次高层策略 */
  function maybeRequestDeepSeek(ai, time) {
    if (ai.deepseekBusy) return;
    if (time < ai.deepseekNextAt) return;
    if (RTS.state.phase !== 'running') return;
    ai.deepseekBusy = true;
    requestDeepSeek(ai, time);
  }

  function requestDeepSeek(ai, time) {
    const st = RTS.state;
    const enemy = st.enemy;
    const player = st.player;
    const myArmy = countArmy(enemy);
    const enemyArmy = countArmy(player);

    const payload = {
      time: Math.round(time),
      myGold: Math.round(enemy.gold),
      myPop: enemy.units.size,
      enemyPop: player.units.size,
      myArmy: { spear: myArmy.spear, sword: myArmy.sword, archer: myArmy.archer, cavalry: myArmy.cavalry },
      enemyArmy: { spear: enemyArmy.spear, sword: enemyArmy.sword, archer: enemyArmy.archer, cavalry: enemyArmy.cavalry },
      baseHp: Math.round(enemy.base.hp),
      enemyBaseHp: Math.round(player.base.hp),
    };

    fetch('/api/ai/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok && data.decision) {
          applyDecision(ai, data.decision, time);
        } else {
          ai.deepseekActive = false;
          ai.lastDeepseekError = (data && data.reason) || 'no_key';
          ai.lastDecision = null;
        }
      })
      .catch((e) => {
        ai.deepseekActive = false;
        ai.lastDeepseekError = 'network_error';
        ai.lastDecision = null;
      })
      .finally(() => {
        ai.deepseekBusy = false;
        ai.deepseekCount++;
        // 下一次调用间隔 20-30s 随机
        const Cfg = C();
        const span = Cfg.aiDecisionIntervalMax - Cfg.aiDecisionIntervalMin;
        ai.deepseekNextAt = time + Cfg.aiDecisionIntervalMin + Math.random() * span;
      });
  }

  function applyDecision(ai, decision, time) {
    ai.deepseekActive = true;
    ai.lastDeepseekError = null;
    ai.lastDecision = decision;
    if (decision.armyFocus) ai.strategy.armyFocus = decision.armyFocus;
    if (typeof decision.aggression === 'number') {
      ai.strategy.aggression = Math.max(0, Math.min(100, decision.aggression));
    }
    if (decision.attackNow) {
      ai.strategy.attackNow = true;
      ai.nextAttackTime = time; // 立即触发进攻
    }
    if (RTS.state.debugMode) {
      RTS.UI.toast('AI 决策：' + (decision.comment || decision.armyFocus || '—'), 'info');
    }
  }

  function update(dt) {
    const st = RTS.state;
    const ai = st.ai;
    const time = st.time;
    const enemy = st.enemy;
    const Cfg = C();

    // DeepSeek 调度
    maybeRequestDeepSeek(ai, time);

    // 生产
    ai.productionTimer -= dt;
    if (ai.productionTimer <= 0) {
      ai.productionTimer = ai.productionInterval;
      produce(ai);
    }

    // 攻击波节奏（受 aggression 影响）
    const aggr = ai.strategy.aggression / 100;
    const cooldown = Cfg.aiAttackCooldownMax - aggr * (Cfg.aiAttackCooldownMax - Cfg.aiAttackCooldownMin);
    const threshold = Math.max(4, Cfg.aiArmyThreshold - Math.round(aggr * 6));

    if (ai.strategy.attackNow) {
      ai.strategy.attackNow = false;
      if (countArmy(enemy).total >= 4) launchAttack(ai);
    }

    if (!ai.attackInProgress && time >= ai.nextAttackTime) {
      if (countArmy(enemy).total >= threshold) {
        launchAttack(ai);
        ai.nextAttackTime = time + cooldown;
      } else {
        // 兵力不足，稍后再试
        ai.nextAttackTime = time + 3;
      }
    }

    // 攻击波持续一段时间后视为结束
    if (ai.attackInProgress && time >= ai.attackWaveEndTime) {
      ai.attackInProgress = false;
    }

    // 回防检查
    ai.defenseTimer -= dt;
    if (ai.defenseTimer <= 0) {
      ai.defenseTimer = 2;
      checkDefense(ai);
    }
  }

  return { init, update, countArmy };
})();
