'use strict';

/**
 * ai.js — 敌方 AI
 *
 * 两层结构（与需求文档一致）：
 * 1. 规则层（保底）：高层「指挥态势」状态机 + 低层单位指令。
 *    态势：build(发育) → rally(集结) → harass(试探) → assault(总攻) → defend(回防) → retreat(撤退)
 * 2. DeepSeek 指挥官层（增强）：每 20-30s 返回高层意志（兵种倾向 / 进攻倾向 / 是否进攻），
 *    作为跨态势的「指挥官参数」注入状态机，失败自动降级为纯规则。
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  // 态势枚举
  const PHASE = {
    build: 'build',
    rally: 'rally',
    harass: 'harass',
    assault: 'assault',
    defend: 'defend',
    retreat: 'retreat',
  };

  const UNIT_TYPES = ['spear', 'sword', 'archer', 'cavalry'];

  function countArmy(faction) {
    const counts = { spear: 0, sword: 0, archer: 0, cavalry: 0, total: 0 };
    faction.units.forEach((u) => {
      counts[u.type]++;
      counts.total++;
    });
    return counts;
  }

  /** 克制某兵种的生产选择（规则层兜底用） */
  function counterOf(type) {
    switch (type) {
      case 'spear': return 'sword';
      case 'sword': return 'cavalry';
      case 'archer': return 'cavalry';
      case 'cavalry': return 'spear';
      default: return 'sword';
    }
  }

  function init() {
    const Cfg = C();
    return {
      phase: PHASE.build,
      phaseEnterTime: 0,
      phaseChanged: false,

      productionTimer: 0,
      productionInterval: 1.5,
      defenseTimer: 0,

      // DeepSeek 相关
      deepseekNextAt: Cfg.aiDecisionIntervalMax,
      deepseekBusy: false,
      deepseekActive: false,
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,

      // 指挥官意志（规则默认值 + DeepSeek 可覆盖）
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
      },

      // 集结/进攻节奏
      nextAttackTime: Cfg.aiFirstAttackTime,
      waveElapsed: 0,
      waveDuration: 22,
      rallyPoint: { x: 0, y: 0 },
    };
  }

  // ---------------------------------------------------------------- 高层态势决策

  /** 计算当前指挥态势，返回新 PHASE；若变化则携带相位切换标记 */
  function evaluatePhase(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const player = st.player;
    const mine = countArmy(enemy);
    const theirs = countArmy(player);

    const ratio = theirs.total > 0 ? mine.total / theirs.total : Infinity;
    const aggr = ai.strategy.aggression / 100;

    // 1) 回防优先：基地附近入侵者达到阈值
    let intruders = 0;
    const defRadius = C().aiDefenseRadius;
    const base = enemy.base;
    player.units.forEach((u) => {
      if (RTS.Unit.distTo(u, base.x, base.y) < defRadius) intruders++;
    });
    if (intruders >= C().aiDefenseIntruders) return PHASE.defend;

    // 2) 兵力劣势严重 → 撤退重整
    if (mine.total >= 3 && ratio < C().aiRetreatThreshold && theirs.total > mine.total + 4) {
      return PHASE.retreat;
    }

    // 3) 兵力优势明显 → 总攻
    const assaultReady = mine.total >= C().aiArmyThreshold &&
      (ratio >= C().aiAssaultRatio || mine.total >= C().aiArmyThreshold + Math.round(aggr * 12));
    if (assaultReady) return PHASE.assault;

    // 4) 试探：达到一定规模，且未到总攻阈值
    if (mine.total >= C().aiHarassThreshold) return PHASE.harass;

    // 5) 集结：有一定兵力但不够进攻，先集合
    if (mine.total >= 4) return PHASE.rally;

    // 6) 默认发育
    return PHASE.build;
  }

  function setPhase(ai, next, time) {
    if (ai.phase !== next) {
      ai.phase = next;
      ai.phaseEnterTime = time;
      ai.phaseChanged = true;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 生产

  function decideProductionType(ai, playerArmy) {
    const weights = { spear: 1, sword: 1, archer: 1, cavalry: 1 };

    // DeepSeek 指挥官倾向：明确指定则高优先级执行
    if (ai.strategy.armyFocus) {
      weights[ai.strategy.armyFocus] += 20;
    } else {
      // 无 DeepSeek 决策时，规则层：反制玩家最强兵种
      let dominant = 'spear';
      let max = -1;
      for (const t of UNIT_TYPES) {
        if (playerArmy[t] > max) {
          max = playerArmy[t];
          dominant = t;
        }
      }
      weights[counterOf(dominant)] += 4;
    }

    const types = Object.keys(weights);
    const totalW = types.reduce((s, t) => s + weights[t], 0);
    let r = Math.random() * totalW;
    for (const t of types) {
      r -= weights[t];
      if (r <= 0) return t;
    }
    return ai.strategy.armyFocus || 'sword';
  }

  /** 是否应持续生产（发育/集结阶段生产，总攻时留军费爆兵） */
  function shouldProduce(ai, phase) {
    if (phase === PHASE.build || phase === PHASE.rally) return true;
    if (phase === PHASE.harass) return true;
    if (phase === PHASE.assault) return true; // 总攻也要维持补充
    return true; // 默认持续生产，队列自然受军费/人口约束
  }

  function produce(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const playerArmy = countArmy(st.player);
    const type = decideProductionType(ai, playerArmy);
    let guard = 0;
    while (guard++ < 6) {
      const check = RTS.Production.canOrder(enemy, type);
      if (!check.ok) break;
      RTS.Production.order(enemy, type);
    }
  }

  // ---------------------------------------------------------------- 低层指令

  /** 计算/刷新集结点（基地前方向着敌方一侧的偏置点） */
  function rallyPointOf(ai) {
    const st = RTS.state;
    const base = st.enemy.base;
    const dirX = st.player.base.x > base.x ? 1 : -1;
    const dist = C().aiRallyPointDist;
    return { x: base.x + dirX * dist, y: base.y + (Math.random() - 0.5) * 80 };
  }

  /** 让部队向集结点集结（松散编队） */
  function rally(ai) {
    const st = RTS.state;
    const pt = rallyPointOf(ai);
    ai.rallyPoint = pt;
    let i = 0;
    st.enemy.units.forEach((u) => {
      if (u.state !== 'idle' && u.state !== 'move') return;
      const ang = (i / Math.max(1, st.enemy.units.size)) * Math.PI * 2;
      const ox = pt.x + Math.cos(ang) * Math.min(90, 20 + i * 1.5);
      const oy = pt.y + Math.sin(ang) * Math.min(90, 20 + i * 1.5);
      RTS.Unit.orderAttackMove(u, ox, oy);
      i++;
    });
  }

  /** 发起进攻波：驱使部队向玩家基地方向推进 */
  function launchAttack(ai, fullCommit) {
    const st = RTS.state;
    const enemy = st.enemy;
    const target = st.player.base;
    const strikeCap = fullCommit ? enemy.units.size : Math.floor(enemy.units.size * 0.75) || 1;
    let ordered = 0;
    enemy.units.forEach((u) => {
      if (ordered >= strikeCap) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove' || u.state === 'attack') {
        const ang = (ordered / Math.max(1, strikeCap)) * Math.PI * 2;
        const spread = Math.min(140, 40 + strikeCap * 2);
        const ox = target.x + Math.cos(ang) * spread;
        const oy = target.y + Math.sin(ang) * spread;
        RTS.Unit.orderAttackMove(u, ox, oy);
        ordered++;
      }
    });
    ai.waveElapsed = 0;
    return ordered > 0;
  }

  /** 回防：命令空闲单位迎击基地附近的入侵者 */
  function defend(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const base = enemy.base;
    const radius = C().aiDefenseRadius;
    enemy.units.forEach((u) => {
      if (u.state !== 'idle' && u.state !== 'move') return;
      if (RTS.Unit.distTo(u, base.x, base.y) > radius * 2) {
        // 远处单位也撤回基地附近
        RTS.Unit.orderAttackMove(u, base.x + (Math.random() - 0.5) * 160, base.y + (Math.random() - 0.5) * 160);
        return;
      }
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
    });
  }

  /** 撤退：部队撤回基地附近重整 */
  function retreat(ai) {
    const st = RTS.state;
    const base = st.enemy.base;
    enemyRetreatAll(base);
  }

  function enemyRetreatAll(base) {
    const st = RTS.state;
    st.enemy.units.forEach((u) => {
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') {
        RTS.Unit.orderMove(u, base.x + (Math.random() - 0.5) * 200, base.y + (Math.random() - 0.5) * 200);
      }
    });
  }

  // ---------------------------------------------------------------- DeepSeek

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
      phase: ai.phase,
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
      .catch(() => {
        ai.deepseekActive = false;
        ai.lastDeepseekError = 'network_error';
        ai.lastDecision = null;
      })
      .finally(() => {
        ai.deepseekBusy = false;
        ai.deepseekCount++;
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
      // 指挥官下令立即进攻：强制进入 assault（若兵力足够），否则先集结
      ai.nextAttackTime = time;
      const mine = countArmy(RTS.state.enemy);
      if (mine.total >= C().aiArmyThreshold) {
        ai.phase = PHASE.assault;
        ai.phaseEnterTime = time;
        ai.phaseChanged = true;
      } else {
        ai.phase = PHASE.rally;
        ai.phaseEnterTime = time;
        ai.phaseChanged = true;
      }
    }
    if (RTS.state.debugMode) {
      RTS.UI.toast('AI 决策：' + (decision.comment || decision.armyFocus || '—'), 'info');
    }
  }

  // ---------------------------------------------------------------- 每帧更新

  function update(dt) {
    const st = RTS.state;
    const ai = st.ai;
    const time = st.time;
    const enemy = st.enemy;
    const Cfg = C();

    maybeRequestDeepSeek(ai, time);

    // 1) 高层态势决策（每 0.5s 评估一次，避免高频抖动）
    ai.defenseTimer -= dt;
    ai.phaseChanged = false;
    if (ai.defenseTimer <= 0) {
      ai.defenseTimer = 0.5;
      const next = evaluatePhase(ai);
      setPhase(ai, next, time);
    }

    // 2) 生产（受态势影响）
    ai.productionTimer -= dt;
    if (ai.productionTimer <= 0) {
      ai.productionTimer = ai.productionInterval;
      if (shouldProduce(ai, ai.phase)) produce(ai);
    }

    // 3) 按态势执行低层指令
    executePhase(ai, enemy, time, Cfg);

    // 4) 总攻波计时衰减
    if (ai.phase === PHASE.assault) {
      ai.waveElapsed += dt;
    }
  }

  function executePhase(ai, enemy, time, Cfg) {
    switch (ai.phase) {
      case PHASE.build:
        // 发育：少量部队不出击，就地待命（idle 自动索敌兜底）
        break;

      case PHASE.rally:
        rally(ai);
        break;

      case PHASE.harass:
        // 试探性小规模骚扰，不投入全部兵力
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          launchAttack(ai, false);
          const aggr = ai.strategy.aggression / 100;
          const cooldown = Cfg.aiAttackCooldownMax - aggr * (Cfg.aiAttackCooldownMax - Cfg.aiAttackCooldownMin);
          ai.nextAttackTime = time + cooldown;
        }
        break;

      case PHASE.assault:
        // 总攻：投入全部兵力
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) {
          launchAttack(ai, true);
        }
        break;

      case PHASE.defend:
        defend(ai);
        break;

      case PHASE.retreat:
        retreat(ai);
        break;
    }
  }

  return { init, update, countArmy, PHASE };
})();
