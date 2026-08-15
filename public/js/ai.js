'use strict';

/**
 * ai.js — 指挥官 AI（v7：按阵营参数化的 LLM 接管控制器）
 *
 * 两层结构：
 * 1. 规则层（保底）：34 种态势的指挥状态机 + 低层单位指令。
 * 2. 大模型指挥官层：每 3-6s 返回高层意志（armyFocus / aggression / stance /
 *    lane / targetFocus / attackNow），失败自动降级为纯规则。
 *
 * v7 起支持同时存在两个 AI 实例：
 *   - RTS.state.ai         → 敌方 AI（owner='enemy'）
 *   - RTS.state.playerAI   → 玩家 AI 接管（owner='player'，点顶部按钮创建/销毁）
 * 每个实例可独立选择大模型 provider（'deepseek' | 'doubao'），
 * 所有内部函数通过 mine(ai)/theirs(ai) 拿到己方/对方阵营，与地图/单位定义无关。
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  // ------------------------------------------------------------------ 状态枚举（34 态）
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
  };

  // LLM 可指定的态势白名单（与 server.js clampDecision 保持一致）
  const STANCE_LIST = Object.values(PHASE);
  const LANE_LIST = ['top', 'mid', 'bottom'];
  const TARGET_LIST = ['base', 'army', 'econ'];

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

      // 大模型相关
      deepseekNextAt: 0, // 开局立即请求，之后按短间隔连续刷新
      deepseekBusy: false,
      deepseekActive: false,
      deepseekEverActive: false, // 是否已成功接管（接管后规则层永不再参与）
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,

      // 指挥官意志（由大模型注入）
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
        lane: null,        // 'top' | 'mid' | 'bottom'
        targetFocus: null, // 'base' | 'army' | 'econ'
        squad: null,       // v9：分队指令 { type, task, lane }——只命令某个兵种（同一兵种=一个编队）
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

  /**
   * v4：战略状态完全由大模型决定（applyDecision 直接切换 phase）。
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

  // ------------------------------------------------------------------ 生产

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

  function produce(ai, boost) {
    const controlled = mine(ai);
    const opponentArmy = countArmy(theirs(ai));
    const type = decideProductionType(ai, opponentArmy);
    let guard = 0;
    const budget = boost ? 4 : 2;
    while (guard++ < budget) {
      const check = RTS.Production.canOrder(controlled, type);
      if (!check.ok) break;
      RTS.Production.order(controlled, type);
    }
  }

  function aiUpgrade(ai) {
    const controlled = mine(ai);
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

  // ------------------------------------------------------------------ 低层指令

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

  /**
   * 普通态势可重新下令的单位：仅「空闲」单位。
   * 在途（move/attackMove）与交战（attack）中的单位保持当前任务——
   * 避免 LLM 每 3-6s 换一次态势时，把正在前往金矿的部队反复拽回来（来回横跳）。
   * v9：excludeType——当大模型下达「分队指令」时，该兵种由分队执行器单独指挥，
   * 普通态势不得再对其下令（避免同一支部队被两个执行器来回拉扯）。
   */
  function freeUnits(faction, excludeType) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (excludeType && u.type === excludeType) return;
      if (u.state === 'idle') out.push(u);
    });
    return out;
  }

  /**
   * 强制召回单位：空闲 + 在途（+ 可选交战）。用于防守/撤退/总攻等紧急态势，
   * 此时应打断低优先级任务，把部队拉过来应对。
   */
  function recallUnits(faction, includeAttacking, excludeType) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (excludeType && u.type === excludeType) return;
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

  /** v9：取出某兵种（编队）的可指挥单位；includeAttacking=true 时含交战单位（用于进攻/撤退） */
  function unitsOfType(faction, type, includeAttacking) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0 || u.type !== type) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove' || (includeAttacking && u.state === 'attack')) {
        out.push(u);
      }
    });
    return out;
  }

  /** 把一组单位分配到一组目标点（attackMove，松散编队）。
   *  v7.1：跳过「已到位」或「正在前往同一目标」的单位，避免状态机反复下令导致的原地抖动。 */
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
   * 分路进攻。force=true（总攻/围城/防守反击）：召回在途单位一起压上；
   * force=false（骚扰/佯攻）：只调动空闲单位，不打断正在执行的任务。
   */
  function attackLanes(ai, fullCommit, lanes, force) {
    const excl = squadTypeOf(ai);
    const units = force ? recallUnits(mine(ai), true, excl) : freeUnits(mine(ai), excl);
    if (units.length === 0) return;
    const strikeCap = fullCommit ? units.length : Math.max(1, Math.floor(units.length * 0.75));
    const targets = lanes.map((l) => laneTarget(ai, l));
    const sel = units.slice(0, strikeCap);
    const slots = rallySlots(sel.length);
    sel.forEach((u, idx) => {
      const t = targets[idx % targets.length];
      const slot = slots[idx];
      const sx = t.x + slot.x;
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
    const units = recallUnits(controlled, false, squadTypeOf(ai));
    const slots = rallySlots(units.length);
    let i = 0;
    units.forEach((u) => {
      const slot = slots[i % slots.length];
      if (RTS.Unit.distTo(u, base.x, base.y) > radius * 2) {
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
      if (nearest) RTS.Unit.orderAttack(u, { kind: 'unit', ref: nearest });
      i++;
    });
  }

  /** 撤退/重整：把可指挥单位拉到目标点。
   *  v7.1：force=true 时连「正在交战（attack）」的单位也强制脱离战斗撤走，
   *  否则 LLM 下达撤退/龟缩时前线部队仍会原地交战不后撤。 */
  function retreatTo(ai, point, spreadMul, force) {
    const units = recallUnits(mine(ai), force, squadTypeOf(ai));
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
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
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai)));
    if (units.length === 0) return;
    assignSquads(units, targets, 3);
  }

  function captureExpand(ai) {
    // 抢占离对方基地较近、且非己方的节点
    const nodes = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const oppBase = theirs(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, oppBase.x, oppBase.y) - RTS.Unit.distTo(b, oppBase.x, oppBase.y));
    const targets = nodes.slice(0, 2);
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai)));
    if (units.length === 0) return;
    assignSquads(units, targets, 3);
  }

  function assignSquads(units, targets, perSquad) {
    const assigned = new Map();
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
    assignSquads(units, nodes.slice(0, 3), 2);
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
    const focusR = C().focusFireRadius;
    recallUnits(controlled, false, squadTypeOf(ai)).forEach((u) => {
      const d = RTS.Unit.distTo(u, best.ref.x, best.ref.y);
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

  // ------------------------------------------------------------------ 大模型调用

  function maybeRequestLLM(ai, time) {
    if (ai.deepseekBusy) return;
    if (time < ai.deepseekNextAt) return;
    if (RTS.state.phase !== 'running') return;
    ai.deepseekBusy = true;
    requestLLM(ai, time);
  }

  function requestLLM(ai, time) {
    const controlled = mine(ai);
    const opponent = theirs(ai);
    const myArmy = countArmy(controlled);
    const opponentArmy = countArmy(opponent);

    // 动态构建各兵种数量（键为单位 id，随注册表变化）
    const myArmyCounts = {};
    const opponentArmyCounts = {};
    for (const id of RTS.Units.ids()) {
      myArmyCounts[id] = myArmy[id] || 0;
      opponentArmyCounts[id] = opponentArmy[id] || 0;
    }

    const payload = {
      side: ai.owner,               // 让服务端知道扮演哪一方指挥官
      provider: ai.provider,        // deepseek | doubao
      time: Math.round(time),
      stance: ai.phase,
      map: RTS.Maps.current().id,
      myGold: Math.round(controlled.gold),
      myWood: Math.round(controlled.wood),
      myStone: Math.round(controlled.stone),
      myPop: controlled.units.size,
      enemyPop: opponent.units.size,
      myArmy: myArmyCounts,
      enemyArmy: opponentArmyCounts,
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

  /** 大模型决策的无 comment 兜底摘要 */
  function decisionSummary(ai, decision) {
    const parts = [];
    if (decision.stance) {
      parts.push('态势：' + ((PHASE_LABEL[decision.stance]) || decision.stance));
    }
    if (decision.armyFocus && RTS.Units.get(decision.armyFocus)) {
      parts.push('主造：' + RTS.Units.get(decision.armyFocus).name);
    }
    // v9：分队（编队）指令摘要
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

  function applyDecision(ai, decision, time) {
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
    // 内不重复翻转（LLM 每 3-6s 刷新，若每次都换态势，正在前往金矿的部队会被反复拽回）。
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

    // v9：分队（编队）指令——{ type, task, lane }，只命令该兵种；
    // 本次决策未提供 squad 则清空（恢复为全体统一指挥）
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
      RTS.UI.aiMessage(ai.owner, text);
    }
  }

  // ------------------------------------------------------------------ 每帧更新

  function updateAI(ai, dt) {
    const st = RTS.state;
    if (!st) return;
    const time = st.time;
    const controlled = mine(ai);

    maybeRequestLLM(ai, time);

    // 大模型尚未成功接管前，用极简降级自动驾驶保底（接管后规则永不再参与）
    if (!ai.deepseekEverActive) {
      ai.defenseTimer -= dt;
      if (ai.defenseTimer <= 0) {
        ai.defenseTimer = 0.5;
        degradedPilot(ai, time);
      }
    }

    // 2) 生产（态势影响生产强度）
    ai.productionTimer -= dt;
    if (ai.productionTimer <= 0) {
      ai.productionTimer = ai.productionInterval;
      const boost = ai.phase === PHASE.boom || ai.phase === PHASE.all_in || ai.phase === PHASE.siege;
      produce(ai, boost);
    }

    // 2.1) 科技升级
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

    // 3) 按态势执行低层指令
    executePhase(ai, controlled, time);

    // v9：分队（编队）指令——与大态势并行，只指挥大模型指定的兵种。
    // 普通态势执行器已通过 squadTypeOf 排除该兵种，两队互不抢单位。
    if (ai.strategy.squad && (ai.phaseChanged || ai.squadTimer <= 0)) {
      executeSquad(ai);
      ai.squadTimer = 3;
    }

    // 清空"相位切换"标记（大模型异步 attackNow 设置的 phaseChanged 已消费）
    ai.phaseChanged = false;

    // 4) 总攻波计时衰减
    if (ai.phase === PHASE.assault_mid || ai.phase === PHASE.assault_top ||
        ai.phase === PHASE.assault_bottom || ai.phase === PHASE.all_in ||
        ai.phase === PHASE.pincer || ai.phase === PHASE.siege) {
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
      case PHASE.fortify: // v9：筑垒——派建筑师建造防御哨塔
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
    }
  }

  function raidEcon(ai) {
    const nodes = nodesOf(theirs(ai).owner); // 对方占的节点是劫掠目标
    if (nodes.length === 0) return;
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai)));
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 4);
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

  // ------------------------------------------------------------------ v9：分队（编队）指令执行器
  // 大模型可通过 squad 字段指定「只命令某个兵种」——同一兵种 = 一个编队，
  // 例如「骑兵侧翼骚扰、步兵扛线」。普通态势执行器已排除该兵种（squadTypeOf），
  // 两队各干各的，互不抢单位。

  /** 把某个兵种（编队）派往敌方基地通道；force=true 全员压上，false 只调空闲 */
  function squadAttackLanes(ai, type, lanes, force) {
    const units = unitsOfType(mine(ai), type, force);
    if (units.length === 0) return;
    const targets = lanes.map((l) => laneTarget(ai, l));
    const slots = rallySlots(units.length);
    units.forEach((u, idx) => {
      const t = targets[idx % targets.length];
      const slot = slots[idx % slots.length];
      const sx = t.x + slot.x;
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
    const units = unitsOfType(mine(ai), type, false);
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 3);
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

  /** v9：筑垒——派空闲建筑师在要地建造防御哨塔 */
  function fortify(ai) {
    if (!RTS.Units.has('architect') || !RTS.Towers) return;
    const controlled = mine(ai);
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return; // 正在施工
      if (u.state === 'idle' || u.state === 'move') architects.push(u);
    });
    if (architects.length === 0) return;
    // 建造点候选：已占资源节点（前沿）→ 己方通道桥头 → 基地两侧
    const spots = [];
    nodesOf(ai.owner).slice(0, 3).forEach((n) => {
      spots.push({ x: n.x + (theirs(ai).base.x > controlled.base.x ? 70 : -70), y: n.y });
    });
    const dirX = theirs(ai).base.x > controlled.base.x ? 1 : -1;
    laneIds().forEach((l) => spots.push({ x: controlled.base.x + dirX * 260, y: laneY(l) }));
    spots.push({ x: controlled.base.x + dirX * 200, y: controlled.base.y - 90 });
    spots.push({ x: controlled.base.x + dirX * 200, y: controlled.base.y + 90 });

    let placed = 0;
    for (const u of architects) {
      const spot = spots[placed % spots.length];
      // 已在途中/已到位的不重复下令（去抖）
      if (u.orderTarget && Math.hypot(u.orderTarget.x - spot.x, u.orderTarget.y - spot.y) < 60) continue;
      const res = RTS.Towers.orderBuild(u, spot.x, spot.y);
      if (res.ok) placed++;
      else if (res.reason === 'cap' || res.reason === 'wood' || res.reason === 'stone') break; // 资源/上限不足就停
    }
  }

  return { init, update: updateAll, updateAll, countArmy, PHASE, PHASE_LABEL, STANCE_LIST };
})();
