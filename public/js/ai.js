'use strict';

/**
 * ai.js — 指挥官 AI（v10：四级指挥链 + 逐单位微指令）
 *
 * v10 架构（大改）：
 * ┌────────────────────────────────────────────────────────────┐
 * │ 主将 general（大模型，3-6s）：战略意图                       │
 * │   stance / aggression / lane / targetFocus / attackNow       │
 * │   + offenseDirective / defenseDirective / economyDirective  │
 * ├────────────────────────────────────────────────────────────┤
 * │ 进攻副将 offense（大模型，4-7s）  防守副将 defense（4-7s）  │
 * │   orders[]：逐单位/逐小队战术命令                            │
 * │   {unitId 或 group+count, task, lane, target}                │
 * ├────────────────────────────────────────────────────────────┤
 * │ 军需官 quartermaster（大模型，5-9s）                         │
 * │   生产计划 production[] / 科技升级 upgrade / 哨塔选址 towers │
 * └────────────────────────────────────────────────────────────┘
 *
 * 副将的命令落到「单位级微指令」（unit.microOrder）：
 *   - 颗粒度从「同兵种编队」下放到「每个单位」——例如主将要求抢占资源，
 *     进攻副将让 3 个斥候同时奔赴 3 座不同的金矿；
 *   - 有微指令的单位被标记为「已占用」，普通态势执行器不得再对其下令，
 *     杜绝「占金矿→换态势→部队被拽回来」的来回横跳；
 *   - 微指令有有效期（aiMicroOrderLifetime），到期自动释放；
 *   - 紧急防守（基地被大部队入侵）与撤退/重整可强制接管微指令单位。
 *
 * 无 Key / 网络失败时：主将降级为极简自动驾驶；副将与军需官不启动，
 * 39 态态势执行器作为「参谋部兜底」继续指挥（与 v9 行为兼容）。
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  // ------------------------------------------------------------------ 状态枚举（39 态）
  const PHASE = {
    // 经济
    build: 'build',             // 发育：早期少量兵力就地扩充
    boom: 'boom',               // 爆兵：扩张期高强度生产
    tech: 'tech',               // 科技：优先五线升级
    eco_defend: 'eco_defend',   // 经济防守：生产 + 基地警戒
    fortify: 'fortify',         // 筑垒：派建筑师在要地建造防御哨塔（v9）
    // 侦查
    scout: 'scout',             // 侦查：派快马探路
    scout_hold: 'scout_hold',   // 侦查驻守：扼守视野点
    counter_scout: 'counter_scout', // 反侦察：清除己方半场入侵者
    // 地图控制
    capture_gold: 'capture_gold',   // 占领金矿
    capture_wood: 'capture_wood',   // 占领伐木场
    capture_stone: 'capture_stone', // 占领采石场
    capture_expand: 'capture_expand', // 前哨扩张：抢占前沿节点
    node_garrison: 'node_garrison', // 资源驻守：守住已占节点
    // 集结
    rally: 'rally',             // 集结：向集结点收拢
    rally_hold: 'rally_hold',   // 集结待命：保持编队不动
    reinforce: 'reinforce',     // 增援：向前线输送兵力
    // 骚扰
    harass: 'harass',           // 试探：小规模骚扰
    harass_flank: 'harass_flank', // 侧翼骚扰：绕边路牵制
    harass_econ: 'harass_econ', // 劫掠经济：突袭敌方资源点
    // 进攻
    assault_mid: 'assault_mid',     // 中路总攻
    assault_top: 'assault_top',     // 上路总攻
    assault_bottom: 'assault_bottom', // 下路总攻
    all_in: 'all_in',               // 倾巢一击
    pincer: 'pincer',               // 钳形夹击：上下两路包抄
    feint: 'feint',                 // 佯攻：一路虚张声势
    siege: 'siege',                 // 围城：集中攻击敌方基地
    // 防守
    defend: 'defend',               // 回防：迎击基地附近入侵者
    defend_choke: 'defend_choke',   // 隘口防守：扼守桥头
    defend_node: 'defend_node',     // 资源防守：守住被夺资源点
    counter_attack: 'counter_attack', // 防守反击：击退后反推
    fallback: 'fallback',           // 有序后撤：边打边退
    // 撤退 / 重整
    retreat: 'retreat',             // 撤退：撤回基地重整
    regroup: 'regroup',             // 重整：基地集结编队
    turtle: 'turtle',               // 龟缩：全员回守基地
    ambush: 'ambush',               // 伏击：森林掩体设伏
    // v10 新增态势
    guerrilla: 'guerrilla',         // 游击：小股多路骚扰 + 抢资源并行
    priority_defense: 'priority_defense', // 重点防守：守住已占资源点与桥头
    sneak: 'sneak',                 // 偷家：快速单位绕侧路直取敌方基地
    hold_line: 'hold_line',         // 防线推进：集结后缓慢推进并驻守
  };

  const PHASE_LABEL = {
    build: '发育',
    boom: '爆兵',
    tech: '科技',
    eco_defend: '经济防守',
    fortify: '筑垒',
    scout: '侦查',
    scout_hold: '侦查驻守',
    counter_scout: '反侦察',
    capture_gold: '占金矿',
    capture_wood: '占伐木场',
    capture_stone: '占采石场',
    capture_expand: '前哨扩张',
    node_garrison: '资源驻守',
    rally: '集结',
    rally_hold: '集结待命',
    reinforce: '增援前线',
    harass: '试探',
    harass_flank: '侧翼骚扰',
    harass_econ: '劫掠经济',
    assault_mid: '中路总攻',
    assault_top: '上路总攻',
    assault_bottom: '下路总攻',
    all_in: '倾巢一击',
    pincer: '钳形夹击',
    feint: '佯攻',
    siege: '围城',
    defend: '回防',
    defend_choke: '隘口防守',
    defend_node: '资源防守',
    counter_attack: '防守反击',
    fallback: '有序后撤',
    retreat: '撤退',
    regroup: '重整',
    turtle: '龟缩',
    ambush: '伏击',
    guerrilla: '游击',
    priority_defense: '重点防守',
    sneak: '偷家',
    hold_line: '防线推进',
  };

  // LLM 可指定的态势白名单（与 server.js clampDecision 保持一致）
  const STANCE_LIST = Object.values(PHASE);
  const LANE_LIST = ['top', 'mid', 'bottom'];
  const TARGET_LIST = ['base', 'army', 'econ'];

  // 指挥链角色中文名
  const ROLE_LABEL = {
    general: '主将',
    offense: '进攻副将',
    defense: '防守副将',
    quartermaster: '军需官',
  };

  // 紧急态势：可立即替换当前态势（防守/撤退类），不受态势切换冷却限制
  const URGENT_STANCES = new Set([
    PHASE.defend, PHASE.defend_choke, PHASE.defend_node,
    PHASE.counter_attack, PHASE.counter_scout, PHASE.fallback,
    PHASE.retreat, PHASE.regroup, PHASE.turtle,
  ]);

  // ------------------------------------------------------------------ 阵营取用

  /** 该 AI 控制的一方（'player' | 'enemy'） */
  function mine(ai) {
    return RTS.state[ai.owner];
  }

  /** 该 AI 的对手方 */
  function theirs(ai) {
    return RTS.state[ai.owner === 'player' ? 'enemy' : 'player'];
  }

  // ------------------------------------------------------------------ 统计工具

  function countArmy(faction) {
    const counts = { total: 0 };
    for (const id of RTS.Units.ids()) counts[id] = 0;
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      counts[u.type] = (counts[u.type] || 0) + 1;
      counts.total++;
    });
    return counts;
  }

  function armyCountsObj(army) {
    const out = {};
    for (const id of RTS.Units.ids()) out[id] = army[id] || 0;
    return out;
  }

  /** 统计阵营中某兵种的存活单位数 */
  function countType(faction, type) {
    let n = 0;
    faction.units.forEach((u) => { if (u.hp > 0 && u.type === type) n++; });
    return n;
  }

  function nodesOf(ownerFilter) {
    const st = RTS.state;
    if (!st.resources) return [];
    return st.resources.nodes.filter((n) => ownerFilter ? n.owner === ownerFilter : true);
  }

  /** 从地图定义读取进攻通道 Y（世界像素），地图无关 */
  function laneY(lane) {
    const map = RTS.Maps.current();
    const laneDef = (map.lanes || []).find((l) => l.id === lane);
    if (laneDef) return laneDef.ty * C().tileSize;
    return C().worldHeight / 2;
  }

  function laneTarget(ai, lane) {
    return { x: theirs(ai).base.x, y: laneY(lane) };
  }

  /** 地图定义的所有进攻通道 id（用于分路进攻） */
  function laneIds() {
    const map = RTS.Maps.current();
    return (map.lanes && map.lanes.length ? map.lanes : [{ id: 'mid' }]).map((l) => l.id);
  }

  function init(owner, provider) {
    const Cfg = C();
    return {
      owner: owner || 'enemy',           // 'player' | 'enemy'：控制哪一方
      provider: provider || 'deepseek',  // 'deepseek' | 'doubao'
      phase: PHASE.build,
      phaseEnterTime: 0,
      phaseChanged: false,
      lastStanceChangeTime: -9999, // v7.1：态势切换冷却（防 LLM 每 3-6s 翻烙饼）

      productionTimer: 0,
      productionInterval: 1.5,
      defenseTimer: 0,
      commandTimer: 0,
      squadTimer: 0, // v9：分队（编队）指令节流
      fortifyTimer: 0, // v9：筑垒指令节流

      // 主将（general）：大模型战略决策
      deepseekNextAt: 0, // 开局立即请求，之后按短间隔连续刷新
      deepseekBusy: false,
      deepseekActive: false,
      deepseekEverActive: false, // 是否已成功接管（接管后规则层永不再参与）
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,

      // v10：进攻副将（nextAt=0：主将接管后立即启动，由 everActive 门控）
      offenseNextAt: 0,
      offenseBusy: false,
      offenseActive: false,
      offenseCount: 0,
      offenseError: null,
      offenseOrders: [],       // 最近一次下达的命令集（{task, unitId?, group?, count, lane?, target?}）
      offenseReceivedAt: -999,

      // v10：防守副将
      defenseNextAt: 0,
      defenseBusy: false,
      defenseActive: false,
      defenseCount: 0,
      defenseError: null,
      defenseOrders: [],
      defenseReceivedAt: -999,

      // v10：军需官
      qmNextAt: 0,
      qmBusy: false,
      qmActive: false,
      qmCount: 0,
      qmError: null,
      qm: { plan: [], upgrade: null, towers: [], receivedAt: -999 },

      // 指挥官意志（由大模型注入）
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
        lane: null,        // 'top' | 'mid' | 'bottom'
        targetFocus: null, // 'base' | 'army' | 'econ'
        squad: null,       // v9：分队指令 { type, task, lane }——兼容保留
        offenseDirective: '',   // v10：给进攻副将的指令
        defenseDirective: '',   // v10：给防守副将的指令
        economyDirective: '',   // v10：给军需官的指令
      },

      // 集结/进攻节奏
      nextAttackTime: Cfg.aiFirstAttackTime,
      waveElapsed: 0,
      waveDuration: 22,
      rallyPoint: { x: 0, y: 0 },
      rallyTimer: 0,
      nodeTimer: 3,
      upgradeTimer: 4,
      scoutTimer: 0,
      hasScouted: false,
      feintLane: 'top',
      queueCongestionTime: 0, // v10.2：基地生产队列连续拥堵的累计时长（秒）
    };
  }

  // ------------------------------------------------------------------ 高层态势决策

  function intruderCount(ai) {
    const base = mine(ai).base;
    let n = 0;
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      if (RTS.Unit.distTo(u, base.x, base.y) < C().aiDefenseRadius) n++;
    });
    return n;
  }

  /** 某点附近有多少敌方单位 */
  function intrudersNear(ai, x, y, r) {
    const out = [];
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      if (RTS.Unit.distTo(u, x, y) < r) out.push(u);
    });
    return out;
  }

  /** 离我方基地最近的敌方单位 */
  function nearestIntruder(ai) {
    const base = mine(ai).base;
    let best = null;
    let bd = Infinity;
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      const d = RTS.Unit.distTo(u, base.x, base.y);
      if (d < bd) { bd = d; best = u; }
    });
    return best;
  }

  /**
   * v4：战略状态完全由大模型决定（applyGeneral 直接切换 phase）。
   * 仅当大模型从未成功（无 Key / 网络持续失败）时，才走下面的
   * 「降级自动驾驶」保底，保证无 Key 也能游玩；一旦大模型成功接管，规则不再参与。
   */
  function degradedPilot(ai, time) {
    const Cfg = C();
    const controlled = mine(ai);
    const myArmy = countArmy(controlled);

    if (intruderCount(ai) >= Cfg.aiDefenseIntruders) {
      setPhase(ai, PHASE.defend, time);
    } else if (myArmy.total >= Cfg.aiArmyThreshold) {
      setPhase(ai, PHASE.all_in, time);
    } else if (myArmy.total >= 8 && controlled.wood >= 180 && controlled.stone >= 180) {
      setPhase(ai, PHASE.fortify, time); // v9：资源富余时筑垒
    } else if (myArmy.total >= 4) {
      setPhase(ai, PHASE.rally, time);
    } else {
      setPhase(ai, PHASE.build, time);
    }
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

  // ------------------------------------------------------------------ 生产（军需官计划驱动）

  function decideProductionType(ai, opponentArmy) {
    const ids = RTS.Units.ids();
    const weights = {};
    for (const id of ids) {
      const def = RTS.Units.get(id);
      weights[id] = (def.ai && def.ai.weight) || 1;
    }

    // 大模型指挥官倾向：明确指定且为合法单位 id 时高优先级执行
    if (ai.strategy.armyFocus && RTS.Units.has(ai.strategy.armyFocus)) {
      weights[ai.strategy.armyFocus] += 20;
    }

    // 目标侧重：主攻基地时多造高机动/远程，主攻经济时多造快速单位
    if (ai.strategy.targetFocus === 'base') {
      for (const id of ids) {
        const tags = (RTS.Units.get(id).tags || []);
        if (tags.includes('cavalry') || tags.includes('fast')) weights[id] += 6;
        if (tags.includes('ranged')) weights[id] += 3;
      }
    } else if (ai.strategy.targetFocus === 'econ') {
      for (const id of ids) {
        const tags = (RTS.Units.get(id).tags || []);
        if (tags.includes('fast') || tags.includes('cavalry')) weights[id] += 5;
      }
    }

    // v9：态势驱动的兵种侧重——筑垒多造建筑师、侦查/抢资源多造斥候
    if (ai.phase === PHASE.fortify) {
      weights.architect = (weights.architect || 1) + 20;
    } else if (ai.phase === PHASE.scout || ai.phase === PHASE.scout_hold || ai.phase === PHASE.counter_scout) {
      weights.scout = (weights.scout || 1) + 12;
    } else if (
      ai.phase === PHASE.capture_gold || ai.phase === PHASE.capture_wood ||
      ai.phase === PHASE.capture_stone || ai.phase === PHASE.capture_expand
    ) {
      weights.scout = (weights.scout || 1) + 8;
      weights.cavalry = (weights.cavalry || 1) + 4;
    }

    const types = Object.keys(weights);
    const totalW = types.reduce((s, t) => s + weights[t], 0);
    let r = Math.random() * totalW;
    for (const t of types) {
      r -= weights[t];
      if (r <= 0) return t;
    }
    return ai.strategy.armyFocus && RTS.Units.has(ai.strategy.armyFocus) ? ai.strategy.armyFocus : (ids[0] || 'sword');
  }

  /**
   * v10：生产——军需官生产计划（production[]）优先执行（按顺序、逐项计数），
   * 计划耗尽后回退到态势加权随机（decideProductionType），保证不停产。
   * 计划中「当前买不起」的兵种会被跳过（等军费足够后再造），避免卡死整条生产链。
   * v10.2：人口接近上限且仍需建筑师时，把名额优先让给建筑师（否则人口满后
   * 永远补不上建筑师，兵营/哨塔无从谈起——AI 会「金币太多却建不了兵营」）。
   */
  function produce(ai, boost) {
    const controlled = mine(ai);
    const qm = ai.qm;
    // v10.2：人口 ≥85% 时优先补建筑师
    if (controlled.units.size >= C().populationCap * 0.85 &&
        architectNeeded(ai) &&
        !controlled.productionQueue.some((q) => q.type === 'architect')) {
      const ac = RTS.Production.canOrder(controlled, 'architect');
      if (ac.ok) RTS.Production.order(controlled, 'architect');
    }
    let guard = 0;
    const budget = boost ? 4 : 2;
    while (guard++ < budget) {
      let type = null;
      let fromPlan = false;
      if (qm && qm.plan && qm.plan.length > 0) {
        // 找计划中第一项「当前可下单」的兵种
        for (let i = 0; i < qm.plan.length; i++) {
          if (RTS.Production.canOrder(controlled, qm.plan[i].type).ok) {
            type = qm.plan[i].type;
            fromPlan = true;
            break;
          }
        }
        if (!type) break; // 人口满或全部缺钱：等待
      } else {
        type = decideProductionType(ai, countArmy(theirs(ai)));
      }
      if (!type) break;
      const check = RTS.Production.canOrder(controlled, type);
      if (!check.ok) break;
      RTS.Production.order(controlled, type);
      if (fromPlan) {
        for (let i = 0; i < qm.plan.length; i++) {
          if (qm.plan[i].type === type) {
            qm.plan[i].count--;
            if (qm.plan[i].count <= 0) qm.plan.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  /**
   * v10：科技升级——军需官指定科技优先（且可负担），否则走兜底策略
   * （城防安全优先 → 攻击/护甲均衡 → 破城 → 疾行）。
   */
  function aiUpgrade(ai) {
    const controlled = mine(ai);
    const qm = ai.qm;
    if (qm && qm.upgrade && RTS.Resources.canUpgrade(controlled, qm.upgrade).ok) {
      RTS.Resources.upgrade(controlled, qm.upgrade);
      qm.upgrade = null;
      return;
    }
    // 基地安全优先：城防（耐久 + 箭塔）
    if (RTS.Resources.canUpgrade(controlled, 'defense').ok) {
      RTS.Resources.upgrade(controlled, 'defense');
      return;
    }
    // 攻击/护甲均衡推进（v8：5 级制，先点满再考虑攻城/疾行）
    const a = RTS.Resources.canUpgrade(controlled, 'attack');
    const m = RTS.Resources.canUpgrade(controlled, 'armor');
    const aLvl = RTS.Resources.levelOf(controlled, 'attack');
    const mLvl = RTS.Resources.levelOf(controlled, 'armor');
    if (a.ok && (aLvl <= mLvl || !m.ok)) {
      RTS.Resources.upgrade(controlled, 'attack');
      return;
    }
    if (m.ok) {
      RTS.Resources.upgrade(controlled, 'armor');
      return;
    }
    // 攻击/护甲满级后：破城技术 → 疾行军
    const s = RTS.Resources.canUpgrade(controlled, 'siegecraft');
    if (s.ok) {
      RTS.Resources.upgrade(controlled, 'siegecraft');
      return;
    }
    const mob = RTS.Resources.canUpgrade(controlled, 'mobility');
    if (mob.ok) RTS.Resources.upgrade(controlled, 'mobility');
  }

  // ------------------------------------------------------------------ 低层指令（v10：排除微指令占用单位）

  /** v10：单位是否被微指令占用（普通执行器不得再下令） */
  function microReserved(u) {
    return RTS.Unit.microActive(u);
  }

  /**
   * 普通态势可重新下令的单位：仅「空闲」且「无微指令」的单位。
   * 在途（move/attackMove）、交战（attack）或已被副将微指令占用的单位保持当前任务——
   * 避免 LLM 每 3-6s 换一次态势时，把正在执行任务的部队反复拽回来（来回横跳）。
   */
  function freeUnits(faction, excludeType, includeReserved) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (excludeType && u.type === excludeType) return;
      if (!includeReserved && microReserved(u)) return;
      if (u.state === 'idle') out.push(u);
    });
    return out;
  }

  /**
   * 强制召回单位：空闲 + 在途（+ 可选交战）。用于防守/撤退/总攻等紧急态势。
   * includeReserved=true 时连微指令占用的单位也强制接管（紧急防守/撤退）。
   */
  function recallUnits(faction, includeAttacking, excludeType, includeReserved) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (excludeType && u.type === excludeType) return;
      if (!includeReserved && microReserved(u)) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove' || (includeAttacking && u.state === 'attack')) {
        out.push(u);
      }
    });
    return out;
  }

  /** v9：当前分队指令锁定的兵种 id（无则 null） */
  function squadTypeOf(ai) {
    const sq = ai.strategy && ai.strategy.squad;
    return (sq && sq.type && RTS.Units.has(sq.type)) ? sq.type : null;
  }

  /** v9：取出某兵种（编队）的可指挥单位；includeAttacking=true 时含交战单位 */
  function unitsOfType(faction, type, includeAttacking, includeReserved) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0 || u.type !== type) return;
      if (!includeReserved && microReserved(u)) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove' || (includeAttacking && u.state === 'attack')) {
        out.push(u);
      }
    });
    return out;
  }

  /** 把一组单位分配到一组目标点（attackMove，松散编队）。跳过已到位/在途单位防抖动。 */
  function assignAttackMove(units, points, reachMul) {
    const slots = rallySlots(units.length);
    const tol = C().formationSpacing * (reachMul || 0.9);
    units.forEach((u, i) => {
      const pt = points[i % points.length];
      const slot = slots[i % slots.length];
      const sx = pt.x + slot.x;
      const sy = pt.y + slot.y;
      if (u.orderTarget && Math.hypot(u.orderTarget.x - sx, u.orderTarget.y - sy) < tol) return;
      if (Math.hypot(u.x - sx, u.y - sy) < tol) return;
      RTS.Unit.orderAttackMove(u, sx, sy);
    });
  }

  function rally(ai) {
    if (!ai.rallyPoint || !ai.rallyPoint.x) ai.rallyPoint = rallyPointOf(ai);
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    assignAttackMove(units, [ai.rallyPoint]);
    ai.rallyTimer = 2.5;
  }

  /**
   * 分路进攻。force=true（总攻/围城/防守反击）：召回在途单位一起压上，
   * 并接管副将微指令单位（清除微指令随大部队进攻，保证主将总攻令必达）；
   * force=false（骚扰/佯攻）：只调动空闲单位，不打断正在执行的任务。
   */
  function attackLanes(ai, fullCommit, lanes, force) {
    const excl = squadTypeOf(ai);
    const units = force ? recallUnits(mine(ai), true, excl, true) : freeUnits(mine(ai), excl);
    if (units.length === 0) return;
    if (force) units.forEach((u) => RTS.Unit.clearMicro(u)); // v10：总攻接管微指令
    const strikeCap = fullCommit ? units.length : Math.max(1, Math.floor(units.length * 0.75));
    const targets = lanes.map((l) => laneTarget(ai, l));
    const sel = units.slice(0, strikeCap);
    const slots = rallySlots(sel.length);
    // v10：远程单位站后排（目标点向己方一侧偏移 140px），近战顶前面
    const dirX = theirs(ai).base.x > mine(ai).base.x ? 1 : -1;
    sel.forEach((u, idx) => {
      const t = targets[idx % targets.length];
      const slot = slots[idx];
      const isRanged = !!(RTS.Units.get(u.type) && RTS.Units.get(u.type).ranged);
      const sx = t.x + slot.x - (isRanged ? dirX * 140 : 0);
      const sy = t.y + slot.y;
      // v7.1：已在途/已到位的单位不重复下令
      if (u.orderTarget && Math.hypot(u.orderTarget.x - sx, u.orderTarget.y - sy) < C().formationSpacing) return;
      if (Math.hypot(u.x - sx, u.y - sy) < C().formationSpacing) return;
      RTS.Unit.orderAttackMove(u, sx, sy);
    });
    ai.waveElapsed = 0;
  }

  function defend(ai) {
    const controlled = mine(ai);
    const base = controlled.base;
    const radius = C().aiDefenseRadius;
    // v10：基地被大部队入侵时，连微指令单位也强制接管回防（清掉其微指令）
    const urgent = intruderCount(ai) >= C().aiDefenseIntruders;
    const units = recallUnits(controlled, false, squadTypeOf(ai), urgent);
    const slots = rallySlots(units.length);
    let i = 0;
    units.forEach((u) => {
      const slot = slots[i % slots.length];
      if (RTS.Unit.distTo(u, base.x, base.y) > radius * 2) {
        if (urgent) RTS.Unit.clearMicro(u);
        RTS.Unit.orderAttackMove(u, base.x + slot.x * 0.5, base.y + slot.y * 0.5);
        i++;
        return;
      }
      let nearest = null;
      let nd = Infinity;
      theirs(ai).units.forEach((p) => {
        if (p.hp <= 0) return;
        const d = RTS.Unit.distTo(u, p.x, p.y);
        if (d < nd) { nd = d; nearest = p; }
      });
      if (nearest) {
        if (urgent) RTS.Unit.clearMicro(u);
        RTS.Unit.orderAttack(u, { kind: 'unit', ref: nearest });
      }
      i++;
    });
  }

  /** 撤退/重整：把可指挥单位拉到目标点。force=true 时连交战单位也强制脱离战斗撤走。 */
  function retreatTo(ai, point, spreadMul, force) {
    // v10：撤退/重整属于紧急态势，强制接管微指令单位（清掉其微指令一起撤）
    const units = recallUnits(mine(ai), force, squadTypeOf(ai), true);
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.clearMicro(u);
      RTS.Unit.orderMove(u, point.x + slot.x * (spreadMul || 0.6), point.y + slot.y * (spreadMul || 0.6));
    });
  }

  /** v9：把「抢占资源」的可指挥单位排序——斥候/骑兵等快速单位优先（抢资源靠速度） */
  function fastFirst(units) {
    const isFast = (u) => {
      const tags = (RTS.Units.get(u.type) && RTS.Units.get(u.type).tags) || [];
      return u.type === 'scout' || tags.includes('fast') || tags.includes('cavalry');
    };
    return units.slice().sort((a, b) => (isFast(b) ? 1 : 0) - (isFast(a) ? 1 : 0));
  }

  function captureType(ai, type) {
    const nodes = nodesOf(null).filter((n) => n.type === type && n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const base = mine(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, base.x, base.y) - RTS.Unit.distTo(b, base.x, base.y));
    const targets = nodes.slice(0, 2);
    // v10.1：抢占任务排除建筑师（建筑师不该被派去抢矿送死）
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, targets, 3, 'capture');
  }

  function captureExpand(ai) {
    // 抢占离对方基地较近、且非己方的节点
    const nodes = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const oppBase = theirs(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, oppBase.x, oppBase.y) - RTS.Unit.distTo(b, oppBase.x, oppBase.y));
    const targets = nodes.slice(0, 2);
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, targets, 3, 'capture');
  }

  /**
   * 把一组单位分配到一组目标点。v10.1：被派的单位同步获得「微指令」占用标记
   * （kind: 'capture' 抢占 / 'hold' 驻守 / 'raid' 劫掠）——这样即使态势在
   * capture_gold ↔ capture_wood ↔ rally 之间切换，已到位驻守的单位也不会被
   * 普通态势执行器拉走（freeUnits 排除微指令占用），杜绝「斥候原地打转折返」。
   */
  function assignSquads(units, targets, perSquad, kind) {
    const assigned = new Map();
    const k = kind || 'capture';
    units.forEach((u) => {
      if (u.state !== 'idle' && u.state !== 'move' && u.state !== 'attackMove') return;
      for (const target of targets) {
        const n = assigned.get(target) || 0;
        if (n >= perSquad) continue;
        if (Math.hypot(u.x - target.x, u.y - target.y) < target.radius * 0.7) continue; // 已驻守节点
        const off = rallySlots(perSquad)[n];
        const sx = target.x + off.x * 0.5;
        const sy = target.y + off.y * 0.5;
        if (u.orderTarget && Math.hypot(u.orderTarget.x - sx, u.orderTarget.y - sy) < target.radius * 0.5) continue; // 已在途中
        RTS.Unit.orderAttackMove(u, sx, sy);
        // v10.1：微指令占用（源为 'stance' 兜底执行器）
        u.microOrder = {
          kind: k,
          x: target.x,
          y: target.y,
          radius: k === 'raid' ? target.radius * 0.7 : target.radius * 0.8,
          nodeId: target.id,
          waypoints: null,
          wpIndex: 0,
          targetId: null,
          until: RTS.state.time + C().aiMicroOrderLifetime,
          source: 'stance',
        };
        assigned.set(target, n + 1);
        break;
      }
    });
  }

  function garrisonNodes(ai) {
    const nodes = nodesOf(ai.owner);
    if (nodes.length === 0) return;
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 3), 2, 'hold');
  }

  function scout(ai) {
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    // v9：优先派斥候（scout）侦查，其次骑兵/快速单位
    const scouts = units.filter((u) => u.type === 'scout');
    const fast = units.filter((u) => {
      const tags = (RTS.Units.get(u.type) && RTS.Units.get(u.type).tags) || [];
      return tags.includes('fast') || tags.includes('cavalry');
    });
    const squad = (scouts.length > 0 ? scouts : fast.length > 0 ? fast : units).slice(0, C().aiScoutSquad);
    const probeLanes = laneIds();
    const probes = probeLanes.map((l) => ({ x: theirs(ai).base.x - 300, y: laneY(l) }));
    squad.forEach((u, i) => {
      const p = probes[i % probes.length];
      RTS.Unit.orderAttackMove(u, p.x, p.y);
    });
    ai.hasScouted = true;
  }

  function scoutHold(ai) {
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    const chokepoint = { x: (theirs(ai).base.x + mine(ai).base.x) / 2, y: laneY('mid') };
    assignAttackMove(units.slice(0, C().aiScoutSquad), [chokepoint]);
  }

  function ambush(ai) {
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    // 在桥头附近的森林设伏：找最近可通行森林格
    const mid = { x: (theirs(ai).base.x + mine(ai).base.x) / 2, y: laneY('mid') };
    const ambushPts = [mid];
    assignAttackMove(units.slice(0, 8), ambushPts);
  }

  function focusFire(ai, target) {
    const controlled = mine(ai);
    let best = null;
    if (target === 'base') {
      best = { kind: 'base', ref: theirs(ai).base };
    } else {
      let nd = Infinity;
      const base = controlled.base;
      theirs(ai).units.forEach((p) => {
        if (p.hp <= 0) return;
        const d = RTS.Unit.distTo(p, base.x, base.y);
        if (d < nd) { nd = d; best = { kind: 'unit', ref: p }; }
      });
    }
    if (!best) return;
    // v7.1：集火更精确——圈内单位直接攻击，圈外单位先压到目标附近，
    // 正在交战的单位不打断（避免围城时把满场部队都拽过来挤成一团）。
    // v10：围城（siege）是强制态势，接管微指令单位一起攻城。
    const focusR = C().focusFireRadius;
    recallUnits(controlled, false, squadTypeOf(ai), true).forEach((u) => {
      const d = RTS.Unit.distTo(u, best.ref.x, best.ref.y);
      RTS.Unit.clearMicro(u);
      if (d <= focusR) {
        RTS.Unit.orderAttack(u, best);
      } else {
        RTS.Unit.orderAttackMove(u, best.ref.x, best.ref.y);
      }
    });
  }

  function fallback(ai) {
    const base = mine(ai).base;
    // 边打边退：撤到基地与中线之间的重整点
    const staging = { x: base.x + (theirs(ai).base.x - base.x) * 0.4, y: base.y };
    const units = recallUnits(mine(ai), false, squadTypeOf(ai));
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.orderAttackMove(u, staging.x + slot.x, staging.y + slot.y);
    });
  }

  function raidEcon(ai) {
    const nodes = nodesOf(theirs(ai).owner); // 对方占的节点是劫掠目标
    if (nodes.length === 0) return;
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 4, 'raid');
  }

  function defendChoke(ai) {
    const base = mine(ai).base;
    // 在己方一侧的各通道桥头布防（通道来自地图定义）
    const dirX = theirs(ai).base.x > base.x ? 1 : -1;
    const chokepoints = laneIds().map((l) => ({ x: base.x + dirX * 220, y: laneY(l) }));
    const units = recallUnits(mine(ai), false, squadTypeOf(ai));
    if (units.length === 0) return;
    assignAttackMove(units, chokepoints);
  }

  // ------------------------------------------------------------------ v10：新态势执行器

  /** 游击：一小队抢资源/劫掠，其余分路骚扰 */
  function guerrilla(ai) {
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    const raiders = units.splice(0, Math.max(1, Math.min(2, Math.floor(units.length * 0.2))));
    if (raiders.length > 0) {
      const open = nodesOf(null).filter((n) => (n.type === 'gold' || n.type === 'wood') && n.owner !== ai.owner);
      if (open.length > 0) {
        open.sort((a, b) => RTS.Unit.distTo(a, mine(ai).base.x, mine(ai).base.y) - RTS.Unit.distTo(b, mine(ai).base.x, mine(ai).base.y));
        assignSquads(raiders, open.slice(0, 2), 2, 'capture');
      } else {
        const eNodes = nodesOf(theirs(ai).owner);
        if (eNodes.length > 0) assignSquads(raiders, eNodes.slice(0, 2), 2, 'raid');
        else {
          const lanes = laneIds();
          assignAttackMove(raiders, [laneTarget(ai, lanes[0] || 'mid')]);
        }
      }
    }
    const patrol = units.slice(0, Math.min(units.length, 12));
    if (patrol.length === 0) return;
    const targets = laneIds().map((l) => ({ x: theirs(ai).base.x - 300, y: laneY(l) }));
    assignAttackMove(patrol, targets);
  }

  /** 重点防守：扼守各通道桥头 + 驻守已占资源点 */
  function priorityDefense(ai) {
    defendChoke(ai);
    garrisonNodes(ai);
  }

  /** 偷家：快速单位绕侧路直取敌方基地 */
  function sneak(ai) {
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai)));
    if (units.length === 0) return;
    const lane = ai.strategy.lane && LANE_LIST.includes(ai.strategy.lane) ? ai.strategy.lane : 'top';
    const target = laneTarget(ai, lane);
    assignAttackMove(units.slice(0, Math.min(8, units.length)), [target]);
  }

  /** 防线推进：向主攻通道 62% 处推进并驻守（集结后的稳步施压；v10 接管微指令单位） */
  function holdLine(ai) {
    const base = mine(ai).base;
    const opp = theirs(ai).base;
    const lane = ai.strategy.lane && LANE_LIST.includes(ai.strategy.lane) ? ai.strategy.lane : 'mid';
    const fx = base.x + (opp.x - base.x) * 0.62;
    const fy = laneY(lane);
    const units = recallUnits(mine(ai), false, squadTypeOf(ai), true);
    if (units.length === 0) return;
    units.forEach((u) => RTS.Unit.clearMicro(u));
    assignAttackMove(units, [{ x: fx, y: fy }]);
  }

  // ------------------------------------------------------------------ v10：微指令（逐单位战术命令）

  /**
   * 给单位下达微指令（v10 核心：颗粒度到每个单位）。
   * kind: capture/hold/defend/intercept（驻守类，到达后守点）| attack/harass/raid/siege/
   *       flank/kite/rally（进攻/移动类）| retreat/flee（纯移动撤退）| patrol（巡逻）
   */
  function assignMicro(ai, unit, kind, x, y, opts) {
    opts = opts || {};
    unit.microOrder = {
      kind,
      x,
      y,
      radius: opts.radius != null ? opts.radius : C().aiMicroHoldRadius,
      nodeId: opts.nodeId || null,
      waypoints: opts.waypoints || null,
      wpIndex: 0,
      targetId: opts.targetId || null,
      until: RTS.state.time + (opts.duration != null ? opts.duration : C().aiMicroOrderLifetime),
      source: opts.source || 'staff',
    };
    if (kind === 'retreat' || kind === 'flee') {
      RTS.Unit.orderMove(unit, x, y);
    } else if (kind === 'patrol') {
      const wp = (unit.microOrder.waypoints && unit.microOrder.waypoints[0]) || { x, y };
      RTS.Unit.orderAttackMove(unit, wp.x, wp.y);
    } else {
      RTS.Unit.orderAttackMove(unit, x, y);
    }
  }

  /** 去抖：单位是否已有同类同目标微指令 */
  function sameMicro(u, kind, x, y, tol) {
    const m = u.microOrder;
    if (!m || m.kind !== kind) return false;
    tol = tol || 60;
    return Math.hypot(m.x - x, m.y - y) < tol;
  }

  /**
   * 解析一条副将命令的目标点列表（v10：count>1 时按数量分发——
   * 例如「3 个斥候抢金矿」会让 3 个斥候各奔一座不同的金矿）。
   * 返回 [{x, y, radius, kind, nodeId?, waypoints?, targetId?}]，可能为空数组。
   */
  function resolveTargets(ai, task, target, lane, count) {
    const me = mine(ai);
    const opp = theirs(ai);
    const st = RTS.state;
    const n = Math.max(1, count || 1);
    switch (task) {
      case 'capture': {
        const type = (target === 'gold' || target === 'wood' || target === 'stone') ? target : null;
        let nodes = nodesOf(null).filter((node) => node.owner !== ai.owner && (!type || node.type === type));
        if (nodes.length === 0) return [];
        if (target === 'expand') {
          nodes.sort((a, b) => RTS.Unit.distTo(a, opp.base.x, opp.base.y) - RTS.Unit.distTo(b, opp.base.x, opp.base.y));
        } else {
          nodes.sort((a, b) => RTS.Unit.distTo(a, me.base.x, me.base.y) - RTS.Unit.distTo(b, me.base.x, me.base.y));
        }
        return nodes.slice(0, Math.min(n, nodes.length)).map((node) => ({
          x: node.x, y: node.y, radius: node.radius * 0.8, nodeId: node.id, kind: 'capture',
        }));
      }
      case 'raid': {
        const nodes = nodesOf(opp.owner);
        if (nodes.length === 0) return [];
        nodes.sort((a, b) => RTS.Unit.distTo(a, me.base.x, me.base.y) - RTS.Unit.distTo(b, me.base.x, me.base.y));
        return nodes.slice(0, Math.min(n, nodes.length)).map((node) => ({
          x: node.x, y: node.y, radius: node.radius * 0.7, nodeId: node.id, kind: 'raid',
        }));
      }
      case 'attack':
      case 'siege': {
        if (target === 'towers') {
          const towers = (st.towers || []).filter((t) => t.owner !== ai.owner && t.hp > 0);
          if (towers.length > 0) {
            towers.sort((a, b) => RTS.Unit.distTo(a, me.base.x, me.base.y) - RTS.Unit.distTo(b, me.base.x, me.base.y));
            const t = towers[0];
            return [{ x: t.x, y: t.y, radius: t.radius + 40, kind: 'siege' }];
          }
        }
        const t = lane ? laneTarget(ai, lane) : { x: opp.base.x, y: me.base.y };
        return [{ x: t.x, y: t.y, radius: 60, kind: task }];
      }
      case 'harass':
      case 'flank': {
        const l = lane || 'top';
        const t = laneTarget(ai, l);
        return [{ x: t.x, y: t.y, radius: 80, kind: 'harass' }];
      }
      case 'kite': {
        // 远程风筝：站在我方半场中线附近，见敌即退射
        const midX = (me.base.x + opp.base.x) / 2;
        return [{ x: midX, y: me.base.y, radius: 100, kind: 'kite' }];
      }
      case 'rally': {
        const rp = ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai);
        return [{ x: rp.x, y: rp.y, radius: 40, kind: 'rally' }];
      }
      // ---- 防守副将任务 ----
      case 'hold':
      case 'defend': {
        if (target === 'node') {
          const owned = nodesOf(ai.owner);
          if (owned.length > 0) {
            const sorted = owned.slice().sort((a, b) => {
              const ta = intrudersNear(ai, a.x, a.y, a.radius * 1.5).length;
              const tb = intrudersNear(ai, b.x, b.y, b.radius * 1.5).length;
              const sa = RTS.Unit.distTo(a, me.base.x, me.base.y) - ta * 300;
              const sb = RTS.Unit.distTo(b, me.base.x, me.base.y) - tb * 300;
              return sa - sb;
            });
            return sorted.slice(0, Math.min(n, sorted.length)).map((node) => ({
              x: node.x, y: node.y, radius: node.radius * 0.8, nodeId: node.id, kind: 'defend',
            }));
          }
        }
        if (target === 'choke' || target === undefined || target === null) {
          const dirX = opp.base.x > me.base.x ? 1 : -1;
          const lanes = lane ? [lane] : laneIds();
          return lanes.map((l) => ({ x: me.base.x + dirX * 220, y: laneY(l), radius: 100, kind: 'hold' }));
        }
        // base_own / 默认
        return [{ x: me.base.x, y: me.base.y, radius: 160, kind: 'defend' }];
      }
      case 'intercept': {
        const intr = nearestIntruder(ai);
        if (!intr) return [];
        return [{ x: intr.x, y: intr.y, radius: 70, kind: 'intercept', targetId: intr.id }];
      }
      case 'retreat': {
        return [{ x: me.base.x, y: me.base.y, radius: 130, kind: 'retreat' }];
      }
      case 'patrol': {
        const l1 = lane || 'top';
        const l2 = lane === 'bottom' ? 'top' : 'bottom';
        const dirX = opp.base.x > me.base.x ? 1 : -1;
        const cx = me.base.x + dirX * 220;
        const wp = [{ x: cx, y: laneY(l1) }, { x: cx, y: laneY(l2) }];
        return [{ x: cx, y: laneY(l1), radius: 80, kind: 'patrol', waypoints: wp }];
      }
    }
    return [];
  }

  /** 按命令挑选具体单位：unitId 精确指定，group+count 按兵种就近挑选（逐单位分配） */
  function unitsForOrder(ai, order, target) {
    const controlled = mine(ai);
    const out = [];
    if (order.unitId) {
      const u = controlled.units.get(order.unitId);
      if (u && u.hp > 0 && !microReserved(u)) out.push(u);
    } else if (order.group && RTS.Units.has(order.group)) {
      const cands = [];
      controlled.units.forEach((u) => {
        if (u.hp <= 0 || u.type !== order.group) return;
        if (microReserved(u)) return;
        cands.push(u);
      });
      if (target) {
        cands.sort((a, b) => RTS.Unit.distTo(a, target.x, target.y) - RTS.Unit.distTo(b, target.x, target.y));
      }
      for (let i = 0; i < cands.length && out.length < order.count; i++) out.push(cands[i]);
    }
    return out;
  }

  /** 落地某副将的命令集：逐条解析目标列表 → 挑选单位 → 逐个分配微指令（带去抖） */
  function executeRoleOrders(ai, role, time) {
    const orders = role === 'offense' ? ai.offenseOrders : ai.defenseOrders;
    if (!orders || orders.length === 0) return;
    if (time - (role === 'offense' ? ai.offenseReceivedAt : ai.defenseReceivedAt) > C().aiOfficerOrderLifetime) return;
    const source = role === 'offense' ? 'offense' : 'defense';
    for (const order of orders) {
      const targets = resolveTargets(ai, order.task, order.target, order.lane, order.count);
      if (targets.length === 0) continue;
      const units = unitsForOrder(ai, order, targets[0]);
      if (units.length === 0) continue;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        const t = targets[i % targets.length];
        if (sameMicro(u, t.kind, t.x, t.y, 60)) continue;
        assignMicro(ai, u, t.kind, t.x, t.y, {
          radius: t.radius,
          nodeId: t.nodeId,
          waypoints: t.waypoints,
          targetId: t.targetId,
          source,
        });
      }
    }
  }

  /**
   * v10.1：找斥候抢占链的下一个目标——离该单位最近的无主资源点
   * （优先同类型，其次任意类型；全部被占则返回 null 结束链）。
   */
  function nextCaptureTarget(ai, unit, prefType) {
    const cands = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (cands.length === 0) return null;
    const same = prefType ? cands.filter((n) => n.type === prefType) : [];
    const list = (same.length > 0 ? same : cands);
    list.sort((a, b) => RTS.Unit.distTo(a, unit.x, unit.y) - RTS.Unit.distTo(b, unit.x, unit.y));
    return list[0];
  }

  /**
   * v10：微指令过期清理 + 完成判定。
   *  - capture 完成（节点已占且安全）→ 不释放，而是链式续接到「最近的下一个无主资源点」：
   *    斥候行为变成可预测的确定性状态机「赴矿 → 占领 → 奔赴最近下一矿」，不会折返；
   *    所有节点被占完才释放（回到池子听候其他调遣）。
   *  - raid 完成（劫掠目标归己方）→ 释放。
   */
  function expireMicroOrders(ai, time) {
    const controlled = mine(ai);
    controlled.units.forEach((u) => {
      const m = u.microOrder;
      if (!m) return;
      if (m.until != null && time > m.until) {
        RTS.Unit.clearMicro(u);
        return;
      }
      if (m.kind === 'capture' && m.nodeId) {
        const n = nodesOf(null).find((x) => x.id === m.nodeId);
        if (n && n.owner === ai.owner && intrudersNear(ai, n.x, n.y, n.radius * 1.3).length === 0) {
          const next = nextCaptureTarget(ai, u, n.type);
          if (next) {
            // 链式续接：奔赴下一个最近的无主资源点（占领 → 再续接 → …）
            m.nodeId = next.id;
            m.x = next.x;
            m.y = next.y;
            m.radius = next.radius * 0.8;
            m.until = time + C().aiMicroOrderLifetime;
            RTS.Unit.orderAttackMove(u, next.x, next.y);
          } else {
            RTS.Unit.clearMicro(u); // 无主节点占完：释放，听候其他调遣
          }
        }
      } else if (m.kind === 'raid' && m.nodeId) {
        const n = nodesOf(null).find((x) => x.id === m.nodeId);
        if (n && n.owner === ai.owner) RTS.Unit.clearMicro(u); // 劫掠成功（敌方节点归我）
      }
    });
  }

  // ------------------------------------------------------------------ v10：四级指挥链请求

  /** 构建副将可指挥单位清单（优先空闲单位，控 token） */
  function buildRoster(ai, cap) {
    const controlled = mine(ai);
    const idle = [];
    const busy = [];
    controlled.units.forEach((u) => {
      if (u.hp <= 0) return;
      (u.state === 'idle' ? idle : busy).push(u);
    });
    const capN = cap || C().aiOfficerRosterCap;
    const out = [];
    for (const u of idle.concat(busy)) {
      if (out.length >= capN) break;
      out.push({ id: u.id, type: u.type, x: Math.round(u.x), y: Math.round(u.y), state: u.state, hp: Math.round(u.hp) });
    }
    return out;
  }

  function buildNodeList(ownerFilter) {
    return nodesOf(ownerFilter).map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) }));
  }

  /** 可建哨塔的位置候选（军需官从这些 spot 里选） */
  function buildTowerCandidates(ai) {
    const me = mine(ai);
    const opp = theirs(ai);
    const dirX = opp.base.x > me.base.x ? 1 : -1;
    const cands = [];
    laneIds().forEach((l) => {
      cands.push({ spot: 'choke_' + l, desc: '桥头(' + l + ')', x: me.base.x + dirX * 260, y: laneY(l) });
    });
    nodesOf(ai.owner).slice(0, 6).forEach((n) => {
      cands.push({ spot: 'node_' + n.id, desc: '资源点(' + n.type + ' #' + n.id + ')', x: n.x + dirX * 70, y: n.y });
    });
    cands.push({ spot: 'base_l', desc: '基地上方侧翼', x: me.base.x + dirX * 200, y: me.base.y - 90 });
    cands.push({ spot: 'base_r', desc: '基地下方侧翼', x: me.base.x + dirX * 200, y: me.base.y + 90 });
    return cands.map((c) => ({ spot: c.spot, desc: c.desc, x: Math.round(c.x), y: Math.round(c.y) }));
  }

  /** 按角色构建请求体 */
  function buildRolePayload(ai, role, time) {
    const controlled = mine(ai);
    const opponent = theirs(ai);
    const myArmy = countArmy(controlled);
    const opponentArmy = countArmy(opponent);
    const base = {
      side: ai.owner,
      provider: ai.provider,
      role,
      time: Math.round(time),
      map: RTS.Maps.current().id,
      stance: ai.phase,
    };
    if (role === 'general') {
      return Object.assign({}, base, {
        myGold: Math.round(controlled.gold),
        myWood: Math.round(controlled.wood),
        myStone: Math.round(controlled.stone),
        myPop: controlled.units.size,
        enemyPop: opponent.units.size,
        myArmy: armyCountsObj(myArmy),
        enemyArmy: armyCountsObj(opponentArmy),
        baseHp: Math.round(controlled.base.hp),
        enemyBaseHp: Math.round(opponent.base.hp),
        myUpgrades: {
          attack: controlled.upgrades.attack,
          armor: controlled.upgrades.armor,
          defense: controlled.upgrades.defense,
          siegecraft: controlled.upgrades.siegecraft || 0,
          mobility: controlled.upgrades.mobility || 0,
        },
        myNodes: nodesOf(ai.owner).length,
        enemyNodes: nodesOf(opponent.owner).length,
        myTowers: (RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0),
        enemyTowers: (RTS.Towers ? RTS.Towers.towerCount(opponent.owner) : 0),
      });
    }
    if (role === 'offense') {
      // 无主节点按距离排序并截断
      const unowned = nodesOf(null).filter((n) => n.owner !== ai.owner);
      unowned.sort((a, b) => RTS.Unit.distTo(a, controlled.base.x, controlled.base.y) - RTS.Unit.distTo(b, controlled.base.x, controlled.base.y));
      return Object.assign({}, base, {
        offenseDirective: ai.strategy.offenseDirective || '',
        lane: ai.strategy.lane,
        targetFocus: ai.strategy.targetFocus,
        myArmy: armyCountsObj(myArmy),
        enemyArmy: armyCountsObj(opponentArmy),
        roster: buildRoster(ai),
        nodes: {
          unowned: unowned.slice(0, 8).map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) })),
          enemy: nodesOf(opponent.owner).slice(0, 6).map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) })),
          mine: nodesOf(ai.owner).slice(0, 6).map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) })),
        },
        myTowers: (RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0),
        enemyTowers: (RTS.Towers ? RTS.Towers.towerCount(opponent.owner) : 0),
      });
    }
    if (role === 'defense') {
      const ctrlBase = controlled.base;
      const intruders = [];
      theirs(ai).units.forEach((u) => {
        if (u.hp <= 0) return;
        if (RTS.Unit.distTo(u, ctrlBase.x, ctrlBase.y) < C().aiDefenseRadius * 1.6) {
          intruders.push({ id: u.id, type: u.type, x: Math.round(u.x), y: Math.round(u.y), hp: Math.round(u.hp) });
        }
      });
      intruders.sort((a, b) => RTS.Unit.distTo(a, ctrlBase.x, ctrlBase.y) - RTS.Unit.distTo(b, ctrlBase.x, ctrlBase.y));
      return Object.assign({}, base, {
        defenseDirective: ai.strategy.defenseDirective || '',
        baseX: Math.round(ctrlBase.x),
        baseY: Math.round(ctrlBase.y),
        baseHp: Math.round(ctrlBase.hp),
        enemyBaseHp: Math.round(opponent.base.hp),
        intruders: intruders.slice(0, 12),
        ownedNodes: nodesOf(ai.owner).slice(0, 8).map((n) => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) })),
        chokepoints: laneIds().map((l) => {
          const dirX = opponent.base.x > controlled.base.x ? 1 : -1;
          return { lane: l, x: Math.round(controlled.base.x + dirX * 220), y: Math.round(laneY(l)) };
        }),
        roster: buildRoster(ai),
        myTowers: (RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0),
        enemyTowers: (RTS.Towers ? RTS.Towers.towerCount(opponent.owner) : 0),
      });
    }
    // quartermaster
    return Object.assign({}, base, {
      economyDirective: ai.strategy.economyDirective || '',
      myGold: Math.round(controlled.gold),
      myWood: Math.round(controlled.wood),
      myStone: Math.round(controlled.stone),
      woodRate: controlled.woodRate || 0,
      stoneRate: controlled.stoneRate || 0,
      myPop: controlled.units.size,
      popCap: C().populationCap,
      myArmy: armyCountsObj(myArmy),
      enemyArmy: armyCountsObj(opponentArmy),
      myUpgrades: {
        attack: controlled.upgrades.attack,
        armor: controlled.upgrades.armor,
        defense: controlled.upgrades.defense,
        siegecraft: controlled.upgrades.siegecraft || 0,
        mobility: controlled.upgrades.mobility || 0,
      },
      myNodes: nodesOf(ai.owner).length,
      enemyNodes: nodesOf(opponent.owner).length,
      myTowers: (RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0),
      enemyTowers: (RTS.Towers ? RTS.Towers.towerCount(opponent.owner) : 0),
      towerCandidates: buildTowerCandidates(ai),
    });
  }

  /** 按角色取 ai 上的字段（general ↔ deepseek*，quartermaster ↔ qm*） */
  function roleField(ai, role, suffix) {
    if (role === 'general') return ai['deepseek' + suffix];
    if (role === 'offense') return ai['offense' + suffix];
    if (role === 'defense') return ai['defense' + suffix];
    return ai['qm' + suffix];
  }

  /** 某个角色是否正在请求 / 是否到点 */
  function maybeRequestRole(ai, role, time) {
    if (RTS.state.phase !== 'running') return;
    if (role !== 'general') {
      // 副将/军需官：主将成功接管后才启动（避免无 Key 时白打请求）
      if (!ai.deepseekEverActive) return;
    }
    if (roleField(ai, role, 'Busy') || time < roleField(ai, role, 'NextAt')) return;
    ai[role === 'general' ? 'deepseekBusy' : role === 'offense' ? 'offenseBusy' : role === 'defense' ? 'defenseBusy' : 'qmBusy'] = true;
    requestRole(ai, role, time);
  }

  function requestRole(ai, role, time) {
    const payload = buildRolePayload(ai, role, time);
    const doFetch = typeof fetch === 'function' ? fetch : null;
    if (!doFetch) {
      // 无 fetch 环境（无头测试/异常）：按失败处理并排下一次请求
      markRoleError(ai, role, 'no_fetch');
      scheduleNextRole(ai, role, time);
      return;
    }
    doFetch('/api/ai/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok && data.decision) {
          applyRoleDecision(ai, role, data.decision, time);
        } else {
          markRoleError(ai, role, (data && data.reason) || 'no_key');
        }
      })
      .catch(() => {
        markRoleError(ai, role, 'network_error');
      })
      .finally(() => {
        scheduleNextRole(ai, role, time);
      });
  }

  /** 请求结束后的收尾：释放 busy、安排下一次请求时间、计数 */
  function scheduleNextRole(ai, role, time) {
    ai[role === 'general' ? 'deepseekBusy' : role === 'offense' ? 'offenseBusy' : role === 'defense' ? 'defenseBusy' : 'qmBusy'] = false;
    const Cfg = C();
    let min = Cfg.aiDecisionIntervalMin;
    let max = Cfg.aiDecisionIntervalMax;
    if (role === 'offense' || role === 'defense') { min = Cfg.aiOfficerIntervalMin; max = Cfg.aiOfficerIntervalMax; }
    else if (role === 'quartermaster') { min = Cfg.aiQuartermasterIntervalMin; max = Cfg.aiQuartermasterIntervalMax; }
    ai[role === 'general' ? 'deepseekNextAt' : role === 'offense' ? 'offenseNextAt' : role === 'defense' ? 'defenseNextAt' : 'qmNextAt'] =
      time + min + Math.random() * (max - min);
    if (role === 'general') ai.deepseekCount++;
    else if (role === 'offense') ai.offenseCount++;
    else if (role === 'defense') ai.defenseCount++;
    else ai.qmCount++;
  }

  function markRoleError(ai, role, reason) {
    if (role === 'general') {
      ai.deepseekActive = false;
      ai.lastDeepseekError = reason;
      ai.lastDecision = null;
    } else if (role === 'offense') {
      ai.offenseError = reason;
      ai.offenseOrders = [];
    } else if (role === 'defense') {
      ai.defenseError = reason;
      ai.defenseOrders = [];
    } else {
      ai.qmError = reason;
      ai.qm = { plan: [], upgrade: null, towers: [], receivedAt: -999 };
    }
  }

  /** 应用某个角色的决策 */
  function applyRoleDecision(ai, role, decision, time) {
    if (role === 'general') { applyGeneral(ai, decision, time); return; }
    if (role === 'offense' || role === 'defense') {
      ai[role + 'Active'] = true;
      ai[role + 'Error'] = null;
      ai[role + 'Orders'] = (decision && decision.orders) || [];
      ai[role + 'ReceivedAt'] = time;
      executeRoleOrders(ai, role, time);
      const n = ai[role + 'Orders'].length;
      const text = (decision && decision.comment) || (ROLE_LABEL[role] + '下达 ' + n + ' 条逐单位命令');
      if (text && RTS.UI && RTS.UI.aiMessage) {
        RTS.UI.aiMessage(ai.owner, '【' + ROLE_LABEL[role] + '】' + text);
      }
      return;
    }
    // quartermaster
    ai.qmActive = true;
    ai.qmError = null;
    ai.qm = {
      plan: (decision && decision.production) || [],
      upgrade: (decision && decision.upgrade) || null,
      towers: (decision && decision.towers) || [],
      receivedAt: time,
    };
    const text = (decision && decision.comment) || qmSummary(ai);
    if (text && RTS.UI && RTS.UI.aiMessage) {
      RTS.UI.aiMessage(ai.owner, '【军需官】' + text);
    }
  }

  /** 军需官决策摘要（无 comment 时兜底） */
  function qmSummary(ai) {
    const qm = ai.qm;
    const parts = [];
    if (qm.plan && qm.plan.length > 0) {
      parts.push('生产:' + qm.plan.map((p) => {
        const def = RTS.Units.get(p.type);
        return (def ? def.name : p.type) + '×' + p.count;
      }).join('、'));
    }
    if (qm.upgrade) {
      parts.push('升级:' + (RTS.CONFIG.upgrades[qm.upgrade] ? RTS.CONFIG.upgrades[qm.upgrade].name : qm.upgrade));
    }
    if (qm.towers && qm.towers.length > 0) {
      parts.push('筑垒:' + qm.towers.slice(0, 3).map((t) => t.spot).join(','));
    }
    return parts.join(' · ') || '暂无计划';
  }

  /** 主将决策的无 comment 兜底摘要 */
  function decisionSummary(ai, decision) {
    const parts = [];
    if (decision.stance) {
      parts.push('态势：' + ((PHASE_LABEL[decision.stance]) || decision.stance));
    }
    if (decision.armyFocus && RTS.Units.get(decision.armyFocus)) {
      parts.push('主造：' + RTS.Units.get(decision.armyFocus).name);
    }
    if (decision.squad && decision.squad.type && RTS.Units.get(decision.squad.type)) {
      const taskLabel = {
        harass: '侧翼骚扰', attack: '分队进攻', defend: '分队回防',
        capture: '分队抢资源', rally: '分队集结', retreat: '分队撤退',
      };
      parts.push('编队：' + RTS.Units.get(decision.squad.type).name + (taskLabel[decision.squad.task] || ''));
    }
    if (decision.lane) {
      parts.push(decision.lane === 'mid' ? '中路' : decision.lane === 'top' ? '上路' : '下路');
    }
    return parts.join(' · ');
  }

  function applyGeneral(ai, decision, time) {
    ai.deepseekActive = true;
    ai.deepseekEverActive = true;
    ai.lastDeepseekError = null;
    ai.lastDecision = decision;
    if (decision.armyFocus) ai.strategy.armyFocus = decision.armyFocus;
    if (typeof decision.aggression === 'number') {
      ai.strategy.aggression = Math.max(0, Math.min(100, decision.aggression));
    }
    // v4：态势完全由大模型决定（直接切换 phase，不再有规则层参与）。
    // v7.1：加态势切换冷却——紧急防守/撤退立即响应；其余态势在 aiStanceHoldTime
    // 内不重复翻转（LLM 每 3-6s 刷新，若每次都换态势，正在执行任务的部队会被反复拽回）。
    if (decision.stance && STANCE_LIST.includes(decision.stance) && decision.stance !== ai.phase) {
      const urgent = URGENT_STANCES.has(decision.stance);
      const allow = urgent || (time - ai.lastStanceChangeTime) >= C().aiStanceHoldTime;
      if (allow) {
        setPhase(ai, decision.stance, time);
        ai.lastStanceChangeTime = time;
      }
    }
    if (decision.lane && LANE_LIST.includes(decision.lane)) ai.strategy.lane = decision.lane;
    if (decision.targetFocus && TARGET_LIST.includes(decision.targetFocus)) ai.strategy.targetFocus = decision.targetFocus;

    // v10：把主将指令转发给下属
    if (typeof decision.offenseDirective === 'string' && decision.offenseDirective) ai.strategy.offenseDirective = decision.offenseDirective;
    if (typeof decision.defenseDirective === 'string' && decision.defenseDirective) ai.strategy.defenseDirective = decision.defenseDirective;
    if (typeof decision.economyDirective === 'string' && decision.economyDirective) ai.strategy.economyDirective = decision.economyDirective;

    // v9：分队（编队）指令——兼容保留；本次决策未提供 squad 则清空
    if (decision.squad && decision.squad.type && RTS.Units.has(decision.squad.type)) {
      ai.strategy.squad = {
        type: decision.squad.type,
        task: decision.squad.task || 'harass',
        lane: LANE_LIST.includes(decision.squad.lane) ? decision.squad.lane : null,
      };
    } else {
      ai.strategy.squad = null;
    }

    if (decision.attackNow) {
      ai.nextAttackTime = time;
      ai.lastStanceChangeTime = time;
      const myTotal = countArmy(mine(ai)).total;
      setPhase(ai, myTotal >= C().aiArmyThreshold ? PHASE.all_in : PHASE.rally, time);
    }
    // v7.1：AI 消息进入常驻提示条（玩家左蓝 / 敌方右红），不再用一闪而过的 toast
    const text = decision.comment || decisionSummary(ai, decision);
    if (text && RTS.UI && RTS.UI.aiMessage) {
      RTS.UI.aiMessage(ai.owner, '【主将】' + text);
    }
  }

  // ------------------------------------------------------------------ 每帧更新

  function updateAI(ai, dt) {
    const st = RTS.state;
    if (!st) return;
    const time = st.time;
    const controlled = mine(ai);

    // 1) 四级指挥链请求（主将 → 副将/军需官）
    maybeRequestRole(ai, 'general', time);
    maybeRequestRole(ai, 'offense', time);
    maybeRequestRole(ai, 'defense', time);
    maybeRequestRole(ai, 'quartermaster', time);

    // 大模型尚未成功接管前，用极简降级自动驾驶保底（接管后规则永不再参与）
    if (!ai.deepseekEverActive) {
      ai.defenseTimer -= dt;
      if (ai.defenseTimer <= 0) {
        ai.defenseTimer = 0.5;
        degradedPilot(ai, time);
      }
    }

    // 2) 生产（军需官计划驱动；无计划时按态势加权）
    ai.productionTimer -= dt;
    if (ai.productionTimer <= 0) {
      ai.productionTimer = ai.productionInterval;
      const boost = ai.phase === PHASE.boom || ai.phase === PHASE.all_in || ai.phase === PHASE.siege;
      produce(ai, boost);
    }

    // 2.1) 科技升级（军需官指定优先）
    ai.upgradeTimer -= dt;
    if (ai.upgradeTimer <= 0) {
      ai.upgradeTimer = 4;
      aiUpgrade(ai);
    }

    // 低层指令节流计时
    ai.rallyTimer -= dt;
    ai.commandTimer -= dt;
    ai.nodeTimer -= dt;
    ai.scoutTimer -= dt;
    ai.squadTimer -= dt;
    ai.fortifyTimer -= dt;

    // v10.2：基地生产队列拥堵计时（连续 ≥ 阈值则累计，否则缓慢消退）
    if (controlled.productionQueue.length >= C().baseQueueBarracksThreshold) {
      ai.queueCongestionTime += dt;
    } else {
      ai.queueCongestionTime = Math.max(0, ai.queueCongestionTime - dt);
    }

    // 3) 微指令过期清理（释放的单位可被再次调动）
    expireMicroOrders(ai, time);

    // 3.1) v10.1/v10.2：基建节奏（确定性，不依赖态势）——
    //      资源富余时按需生产建筑师；有闲置建筑师时优先建兵营（金币富余），否则建哨塔
    if (ai.fortifyTimer <= 0) {
      ai.fortifyTimer = C().aiFortifyRhythm;
      maybeProduceArchitect(ai);
      if (hasIdleArchitect(ai)) {
        if (needBarracks(ai)) buildBarracks(ai);
        else fortify(ai);
      }
    }

    // 4) 副将命令集持续执行（覆盖到新单位/刚空闲的单位；带去抖）
    executeRoleOrders(ai, 'offense', time);
    executeRoleOrders(ai, 'defense', time);

    // 5) 按态势执行兜底低层指令（只指挥无微指令的单位）
    executePhase(ai, controlled, time);

    // v9：分队（编队）指令——与大态势并行（兼容保留）
    if (ai.strategy.squad && (ai.phaseChanged || ai.squadTimer <= 0)) {
      executeSquad(ai);
      ai.squadTimer = 3;
    }

    // 清空"相位切换"标记（大模型异步 attackNow 设置的 phaseChanged 已消费）
    ai.phaseChanged = false;

    // 6) 总攻波计时衰减
    if (ai.phase === PHASE.assault_mid || ai.phase === PHASE.assault_top ||
        ai.phase === PHASE.assault_bottom || ai.phase === PHASE.all_in ||
        ai.phase === PHASE.pincer || ai.phase === PHASE.siege ||
        ai.phase === PHASE.sneak) {
      ai.waveElapsed += dt;
    }
  }

  /** 每帧驱动全部 AI 实例（敌方 + 可选玩家接管） */
  function updateAll(dt) {
    const st = RTS.state;
    if (!st) return;
    updateAI(st.ai, dt);
    if (st.playerAI) updateAI(st.playerAI, dt);
  }

  function executePhase(ai, mineF, time) {
    const Cfg = C();
    const throttle = () => (ai.phaseChanged || ai.commandTimer <= 0);

    switch (ai.phase) {
      // ---------------- 经济
      case PHASE.build:
      case PHASE.boom:
        break; // 就地生产，idle 自动索敌兜底
      case PHASE.tech:
        if (throttle()) { aiUpgrade(ai); ai.commandTimer = 2; }
        break;
      case PHASE.eco_defend:
        if (throttle()) { retreatTo(ai, mineF.base, 0.7); ai.commandTimer = 2; }
        break;
      case PHASE.fortify: // v9：筑垒——派建筑师建造防御哨塔（v10：选址由军需官指定）
        if (throttle()) { fortify(ai); ai.commandTimer = 3; }
        break;

      // ---------------- 侦查
      case PHASE.scout:
        if (ai.phaseChanged || ai.scoutTimer <= 0) { scout(ai); ai.scoutTimer = 6; }
        break;
      case PHASE.scout_hold:
        if (throttle()) { scoutHold(ai); ai.commandTimer = 3; }
        break;
      case PHASE.counter_scout:
        if (throttle()) { defend(ai); ai.commandTimer = 1.5; }
        break;

      // ---------------- 地图控制
      case PHASE.capture_gold:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'gold'); ai.nodeTimer = 4; }
        break;
      case PHASE.capture_wood:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'wood'); ai.nodeTimer = 4; }
        break;
      case PHASE.capture_stone:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'stone'); ai.nodeTimer = 4; }
        break;
      case PHASE.capture_expand:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureExpand(ai); ai.nodeTimer = 4; }
        break;
      case PHASE.node_garrison:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { garrisonNodes(ai); ai.nodeTimer = 4; }
        break;

      // ---------------- 集结
      case PHASE.rally:
        if (ai.phaseChanged || ai.rallyTimer <= 0) rally(ai);
        break;
      case PHASE.rally_hold:
        if (ai.phaseChanged) rally(ai);
        break;
      case PHASE.reinforce:
        if (throttle()) { rally(ai); ai.commandTimer = 2.5; }
        break;

      // ---------------- 骚扰
      case PHASE.harass:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          attackLanes(ai, false, ['mid'], false);
          const aggr = ai.strategy.aggression / 100;
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMax - aggr * (Cfg.aiAttackCooldownMax - Cfg.aiAttackCooldownMin);
        }
        break;
      case PHASE.harass_flank:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          const lane = Math.random() < 0.5 ? 'top' : 'bottom';
          attackLanes(ai, false, [lane], false);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        }
        break;
      case PHASE.harass_econ:
        if (ai.phaseChanged || ai.nodeTimer <= 0) {
          raidEcon(ai);
          ai.nodeTimer = 5;
        }
        break;

      // ---------------- 进攻
      case PHASE.assault_mid:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['mid'], true);
        break;
      case PHASE.assault_top:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top'], true);
        break;
      case PHASE.assault_bottom:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['bottom'], true);
        break;
      case PHASE.all_in:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'mid', 'bottom'], true);
        break;
      case PHASE.pincer:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'bottom'], true);
        break;
      case PHASE.feint:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) {
          attackLanes(ai, false, [ai.feintLane], false);
          ai.feintLane = ai.feintLane === 'top' ? 'bottom' : 'top';
        }
        break;
      case PHASE.siege:
        if (ai.phaseChanged || ai.commandTimer <= 0) {
          focusFire(ai, 'base');
          ai.commandTimer = 2;
        }
        break;

      // ---------------- 防守
      case PHASE.defend:
        if (throttle()) { defend(ai); ai.commandTimer = 1.5; }
        break;
      case PHASE.defend_choke:
        if (throttle()) { defendChoke(ai); ai.commandTimer = 2; }
        break;
      case PHASE.defend_node:
        if (throttle()) { garrisonNodes(ai); ai.commandTimer = 2; }
        break;
      case PHASE.counter_attack:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          defend(ai);
          attackLanes(ai, false, ['mid'], true);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        }
        break;
      case PHASE.fallback:
        if (throttle()) { fallback(ai); ai.commandTimer = 2; }
        break;

      // ---------------- 撤退 / 重整
      case PHASE.retreat:
        if (throttle()) { retreatTo(ai, mineF.base, 0.6, true); ai.commandTimer = 1.5; }
        break;
      case PHASE.regroup:
        if (ai.phaseChanged || ai.commandTimer <= 0) {
          retreatTo(ai, ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai), 0.8, true);
          ai.commandTimer = 2;
        }
        break;
      case PHASE.turtle:
        if (throttle()) { retreatTo(ai, mineF.base, 0.9, true); ai.commandTimer = 1.5; }
        break;
      case PHASE.ambush:
        if (ai.phaseChanged) ambush(ai);
        break;

      // ---------------- v10 新增态势
      case PHASE.guerrilla:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          guerrilla(ai);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        }
        break;
      case PHASE.priority_defense:
        if (throttle()) { priorityDefense(ai); ai.commandTimer = 2.5; }
        break;
      case PHASE.sneak:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) sneak(ai);
        break;
      case PHASE.hold_line:
        if (ai.phaseChanged || ai.commandTimer <= 0) { holdLine(ai); ai.commandTimer = 3; }
        break;
    }
  }

  // ------------------------------------------------------------------ v9：分队（编队）指令执行器（兼容保留）

  /** 把某个兵种（编队）派往敌方基地通道；force=true 全员压上，false 只调空闲 */
  function squadAttackLanes(ai, type, lanes, force) {
    const units = unitsOfType(mine(ai), type, force);
    if (units.length === 0) return;
    const targets = lanes.map((l) => laneTarget(ai, l));
    const slots = rallySlots(units.length);
    const dirX = theirs(ai).base.x > mine(ai).base.x ? 1 : -1;
    const isRanged = !!(RTS.Units.get(type) && RTS.Units.get(type).ranged);
    units.forEach((u, idx) => {
      const t = targets[idx % targets.length];
      const slot = slots[idx % slots.length];
      const sx = t.x + slot.x - (isRanged ? dirX * 140 : 0);
      const sy = t.y + slot.y;
      if (u.orderTarget && Math.hypot(u.orderTarget.x - sx, u.orderTarget.y - sy) < C().formationSpacing) return;
      if (Math.hypot(u.x - sx, u.y - sy) < C().formationSpacing) return;
      RTS.Unit.orderAttackMove(u, sx, sy);
    });
  }

  /** 分队：把某个兵种撤到目标点（含交战单位强制脱离） */
  function squadRetreat(ai, type, point, spreadMul) {
    const units = unitsOfType(mine(ai), type, true);
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.orderMove(u, point.x + slot.x * (spreadMul || 0.6), point.y + slot.y * (spreadMul || 0.6));
    });
  }

  /** 分队：某个兵种去抢占最近的无主资源点（斥候/骑兵效果最佳） */
  function squadCapture(ai, type) {
    const nodes = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const base = mine(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, base.x, base.y) - RTS.Unit.distTo(b, base.x, base.y));
    const units = unitsOfType(mine(ai), type, false).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 3, 'capture');
  }

  /** v9：执行大模型下达的分队（编队）指令 */
  function executeSquad(ai) {
    const sq = ai.strategy && ai.strategy.squad;
    if (!sq || !RTS.Units.has(sq.type)) return;
    const type = sq.type;
    const lane = sq.lane && LANE_LIST.includes(sq.lane) ? sq.lane : 'mid';
    switch (sq.task) {
      case 'attack': // 该兵种全力进攻某通道
        squadAttackLanes(ai, type, [lane], true);
        break;
      case 'defend': // 该兵种回防基地
        squadRetreat(ai, type, mine(ai).base, 0.7);
        break;
      case 'capture': // 该兵种抢占资源点
        squadCapture(ai, type);
        break;
      case 'rally': // 该兵种回集结点集结
        squadRetreat(ai, type, ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai), 0.8);
        break;
      case 'retreat': // 该兵种撤退
        squadRetreat(ai, type, mine(ai).base, 0.6);
        break;
      case 'harass': // 该兵种走侧翼骚扰敌方（默认）
      default:
        squadAttackLanes(ai, type, [lane], false);
        break;
    }
  }

  /**
   * v9：筑垒——派空闲建筑师在要地建造防御哨塔（v10：选址由军需官指定，否则兜底）。
   * v10.1：改为「节奏驱动」——不再只在 fortify 态势下执行，
   * 资源富余时 AI 会定期（fortifyTimer）自动派工，保证哨塔一定会建。
   */
  function fortify(ai) {
    if (!RTS.Units.has('architect') || !RTS.Towers) return;
    const controlled = mine(ai);
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return; // 正在施工
      // v10.1：建筑师不参与战斗，只要非交战就接管（含被普通态势误派去抢资源的情况）
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') architects.push(u);
    });
    if (architects.length === 0) return;
    const spots = resolveTowerSpots(ai);
    if (spots.length === 0) return;
    let placed = 0;
    for (const u of architects) {
      const spot = spots[placed % spots.length];
      // 已在途中/已到位的不重复下令（去抖）
      if (u.orderTarget && Math.hypot(u.orderTarget.x - spot.x, u.orderTarget.y - spot.y) < 60) continue;
      RTS.Unit.clearMicro(u); // v10.1：接管被误派去抢资源/驻守的建筑师
      const res = RTS.Towers.orderBuild(u, spot.x, spot.y);
      if (res.ok) placed++;
      else if (res.reason === 'cap' || res.reason === 'wood' || res.reason === 'stone') break; // 资源/上限不足就停
    }
  }

  /** v10.1：是否还需要（更多）建筑师——（哨塔或兵营）未满 + 木石可负担 + 现有建筑师不足 */
  function architectNeeded(ai) {
    const controlled = mine(ai);
    const Cfg = C();
    const archCount = countType(controlled, 'architect');
    const towers = RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0;
    const barracks = RTS.Barracks ? RTS.Barracks.barracksCount(ai.owner) : 0;
    if (archCount >= Cfg.aiArchitectTarget) return false;
    if (towers >= Cfg.maxTowersPerFaction && barracks >= Cfg.aiBarracksTarget) return false;
    // 木石至少够造哨塔（最便宜的建造）；兵营/更多哨塔等资源够了再建
    if (controlled.wood < Cfg.towerBuildCost.wood || controlled.stone < Cfg.towerBuildCost.stone) return false;
    if (RTS.state.time < Cfg.aiArchitectMinTime) return false; // 前期发育阶段不造
    return true;
  }

  /** 有可派工的建筑师（非施工中、非交战） */
  function hasIdleArchitect(ai) {
    const controlled = mine(ai);
    let found = false;
    controlled.units.forEach((u) => {
      if (u.type === 'architect' && u.hp > 0 && !u.building && u.state !== 'attack') found = true;
    });
    return found;
  }

  /**
   * v10.1：筑垒节奏——按需生产建筑师（确定性）。
   * 直接下单到生产队列（队列不会被军需官新决策替换；v10.2 修复：
   * 之前塞进 qm.plan 末尾的方案会因计划被整体替换而永远轮不到）。
   */
  function maybeProduceArchitect(ai) {
    if (!RTS.Units.has('architect') || !architectNeeded(ai)) return;
    const controlled = mine(ai);
    if (controlled.productionQueue.some((q) => q.type === 'architect')) return; // 已在队列
    const check = RTS.Production.canOrder(controlled, 'architect');
    if (check.ok) RTS.Production.order(controlled, 'architect');
  }

  // ------------------------------------------------------------------ v10.2：兵营节奏（确定性）

  /** 兵营候选位置：基地两侧与前方（避开基地本体） */
  function barracksSpots(ai) {
    const me = mine(ai);
    const opp = theirs(ai);
    const dirX = opp.base.x > me.base.x ? 1 : -1;
    return [
      { x: me.base.x + dirX * 130, y: me.base.y - 170 },
      { x: me.base.x + dirX * 130, y: me.base.y + 170 },
      { x: me.base.x + dirX * 250, y: me.base.y },
    ];
  }

  /**
   * v10.2：是否需要建兵营——兵营未满 + 经济强（金币速率高或当前金币富余）
   * + 生产有瓶颈（基地队列持续拥堵 或 金币接近上限快溢出）+ 木石可负担。
   */
  function needBarracks(ai) {
    if (!RTS.Units.has('architect') || !RTS.Barracks) return false;
    const Cfg = C();
    const controlled = mine(ai);
    if (RTS.Barracks.barracksCount(ai.owner) >= Cfg.aiBarracksTarget) return false;
    const econStrong = controlled.goldRate >= Cfg.aiBarracksMinGoldRate || controlled.gold >= Cfg.aiBarracksMinGold;
    if (!econStrong) return false;
    // 生产有瓶颈：队列持续拥堵、金币接近上限（金币花不完 = 训练跟不上）、或人口接近满编
    const strained = ai.queueCongestionTime >= Cfg.aiBarracksCongestionTime ||
      controlled.gold >= Cfg.goldCap * 0.75 ||
      controlled.units.size >= Cfg.populationCap * 0.85;
    if (!strained) return false;
    if (controlled.wood < Cfg.barracksBuildCost.wood || controlled.stone < Cfg.barracksBuildCost.stone) return false;
    return true;
  }

  /** v10.2：派空闲建筑师在基地附近建造兵营（去抖 + 资源/上限保护） */
  function buildBarracks(ai) {
    if (!RTS.Units.has('architect') || !RTS.Barracks) return;
    const controlled = mine(ai);
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return; // 正在施工
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') architects.push(u);
    });
    if (architects.length === 0) return;
    const spots = barracksSpots(ai);
    let placed = 0;
    for (const u of architects) {
      const spot = spots[placed % spots.length];
      if (u.orderTarget && Math.hypot(u.orderTarget.x - spot.x, u.orderTarget.y - spot.y) < 60) continue;
      RTS.Unit.clearMicro(u);
      const res = RTS.Barracks.orderBuild(u, spot.x, spot.y);
      if (res.ok) placed++;
      else if (res.reason === 'cap' || res.reason === 'wood' || res.reason === 'stone') break; // 资源/上限不足就停
    }
  }

  /** v10：解析哨塔建造点——军需官指定 spot 优先，否则兜底候选 */
  function resolveTowerSpots(ai) {
    const cands = buildTowerCandidates(ai);
    const bySpot = {};
    cands.forEach((c) => { bySpot[c.spot] = c; });
    const out = [];
    const qm = ai.qm;
    if (qm && qm.towers && qm.towers.length > 0) {
      qm.towers.slice().sort((a, b) => (a.priority || 99) - (b.priority || 99)).forEach((t) => {
        if (bySpot[t.spot]) out.push(bySpot[t.spot]);
      });
    }
    if (out.length === 0) {
      // 兜底：桥头 → 已占节点 → 基地两侧
      const dirX = theirs(ai).base.x > mine(ai).base.x ? 1 : -1;
      laneIds().forEach((l) => out.push({ x: mine(ai).base.x + dirX * 260, y: laneY(l) }));
      nodesOf(ai.owner).slice(0, 2).forEach((n) => out.push({ x: n.x + dirX * 70, y: n.y }));
      out.push({ x: mine(ai).base.x + dirX * 200, y: mine(ai).base.y - 90 });
      out.push({ x: mine(ai).base.x + dirX * 200, y: mine(ai).base.y + 90 });
    }
    return out;
  }

  function rallyPointOf(ai) {
    const base = mine(ai).base;
    const dirX = theirs(ai).base.x > base.x ? 1 : -1;
    return { x: base.x + dirX * C().aiRallyPointDist, y: base.y };
  }

  function rallySlots(n) {
    const spacing = C().formationSpacing;
    const cols = Math.ceil(Math.sqrt(Math.max(1, n)));
    const slots = [];
    for (let i = 0; i < Math.max(1, n); i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({
        x: (col - (cols - 1) / 2) * spacing,
        y: (row - (cols - 1) / 2) * spacing,
      });
    }
    return slots;
  }

  return {
    init,
    update: updateAll,
    updateAll,
    countArmy,
    PHASE,
    PHASE_LABEL,
    STANCE_LIST,
    // v10：供调试面板等外部使用的工具
    ROLE_LABEL,
  };
})();
