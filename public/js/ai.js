'use strict';

/**
 * ai.js — 敌方 AI（v3：30+ 状态机 + DeepSeek 指挥官）
 *
 * 两层结构（与需求文档一致）：
 * 1. 规则层（保底）：一个包含 30+ 种态势的指挥状态机 + 低层单位指令。
 *    v3 将原 6 态扩展为 34 态，覆盖 经济 / 侦查 / 地图控制 / 集结 / 骚扰 /
 *    进攻 / 防守 / 撤退重整 八大类，并给出每类的进入条件与执行动作。
 * 2. DeepSeek 指挥官层（增强）：每 20-30s 返回高层意志
 *    （兵种倾向 armyFocus / 进攻倾向 aggression / 指定态势 stance /
 *      主攻方向 lane / 目标侧重 targetFocus / 是否总攻 attackNow），
 *    作为「指挥官意志」注入状态机，失败自动降级为纯规则。
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  // ------------------------------------------------------------------ 状态枚举（34 态）
  const PHASE = {
    // 经济
    build: 'build',             // 发育：早期少量兵力就地扩充
    boom: 'boom',               // 爆兵：扩张期高强度生产
    tech: 'tech',               // 科技：优先三线升级
    eco_defend: 'eco_defend',   // 经济防守：生产 + 基地警戒
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

  // DeepSeek 可指定的态势白名单（与 server.js clampDecision 保持一致）
  const STANCE_LIST = Object.values(PHASE);
  const LANE_LIST = ['top', 'mid', 'bottom'];
  const TARGET_LIST = ['base', 'army', 'econ'];

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

  function laneTarget(lane) {
    const st = RTS.state;
    return { x: st.player.base.x, y: laneY(lane) };
  }

  /** 地图定义的所有进攻通道 id（用于分路进攻） */
  function laneIds() {
    const map = RTS.Maps.current();
    return (map.lanes && map.lanes.length ? map.lanes : [{ id: 'mid' }]).map((l) => l.id);
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
      commandTimer: 0,

      // DeepSeek 相关
      deepseekNextAt: 0, // v4：开局立即请求，之后按短间隔连续刷新
      deepseekBusy: false,
      deepseekActive: false,
      deepseekEverActive: false, // 是否已成功接管（接管后规则层永不再参与）
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,

      // 指挥官意志（由 DeepSeek 注入）
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
        lane: null,        // 'top' | 'mid' | 'bottom'
        targetFocus: null, // 'base' | 'army' | 'econ'
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

  function intruderCount() {
    const st = RTS.state;
    const base = st.enemy.base;
    let n = 0;
    st.player.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (RTS.Unit.distTo(u, base.x, base.y) < C().aiDefenseRadius) n++;
    });
    return n;
  }

  /**
   * v4：战略状态完全由 DeepSeek 决定（applyDecision 直接切换 phase）。
   * 仅当 DeepSeek 从未成功（无 Key / 网络持续失败）时，才走下面的
   * 「降级自动驾驶」保底，保证无 Key 也能游玩；一旦 DeepSeek 成功接管，规则不再参与。
   */
  function degradedPilot(ai, time) {
    const st = RTS.state;
    const mine = countArmy(st.enemy);
    const Cfg = C();

    if (intruderCount() >= Cfg.aiDefenseIntruders) {
      setPhase(ai, PHASE.defend, time);
    } else if (mine.total >= Cfg.aiArmyThreshold) {
      setPhase(ai, PHASE.all_in, time);
    } else if (mine.total >= 4) {
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

  function decideProductionType(ai, playerArmy) {
    const ids = RTS.Units.ids();
    const weights = {};
    for (const id of ids) {
      const def = RTS.Units.get(id);
      weights[id] = (def.ai && def.ai.weight) || 1;
    }

    // DeepSeek 指挥官倾向：明确指定且为合法单位 id 时高优先级执行
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
    const st = RTS.state;
    const enemy = st.enemy;
    const playerArmy = countArmy(st.player);
    const type = decideProductionType(ai, playerArmy);
    let guard = 0;
    const budget = boost ? 4 : 2;
    while (guard++ < budget) {
      const check = RTS.Production.canOrder(enemy, type);
      if (!check.ok) break;
      RTS.Production.order(enemy, type);
    }
  }

  function aiUpgrade(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    if (RTS.Resources.canUpgrade(enemy, 'defense').ok) {
      RTS.Resources.upgrade(enemy, 'defense');
      return;
    }
    const a = RTS.Resources.canUpgrade(enemy, 'attack');
    const m = RTS.Resources.canUpgrade(enemy, 'armor');
    const aLvl = RTS.Resources.levelOf(enemy, 'attack');
    const mLvl = RTS.Resources.levelOf(enemy, 'armor');
    if (a.ok && (aLvl <= mLvl || !m.ok)) RTS.Resources.upgrade(enemy, 'attack');
    else if (m.ok) RTS.Resources.upgrade(enemy, 'armor');
  }

  // ------------------------------------------------------------------ 低层指令

  function rallyPointOf(ai) {
    const st = RTS.state;
    const base = st.enemy.base;
    const dirX = st.player.base.x > base.x ? 1 : -1;
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

  /** 收集可重新下令的单位（idle/move/attackMove） */
  function commandableUnits(faction) {
    const out = [];
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') out.push(u);
    });
    return out;
  }

  /** 把一组单位分配到一组目标点（attackMove，松散编队），跳过已到位者 */
  function assignAttackMove(units, points, reachMul) {
    const slots = rallySlots(units.length);
    let i = 0;
    units.forEach((u) => {
      const pt = points[i % points.length];
      const slot = slots[i % slots.length];
      const sx = pt.x + slot.x;
      const sy = pt.y + slot.y;
      i++;
      const tol = C().formationSpacing * (reachMul || 0.9);
      if (Math.hypot(u.x - sx, u.y - sy) < tol) return;
      RTS.Unit.orderAttackMove(u, sx, sy);
    });
  }

  function rally(ai) {
    const st = RTS.state;
    if (!ai.rallyPoint || !ai.rallyPoint.x) ai.rallyPoint = rallyPointOf(ai);
    const units = commandableUnits(st.enemy);
    if (units.length === 0) return;
    assignAttackMove(units, [ai.rallyPoint]);
    ai.rallyTimer = 2.5;
  }

  function attackLanes(ai, fullCommit, lanes) {
    const st = RTS.state;
    const enemy = st.enemy;
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    const strikeCap = fullCommit ? units.length : Math.max(1, Math.floor(units.length * 0.75));
    const targets = lanes.map((l) => laneTarget(l));
    const sel = units.slice(0, strikeCap);
    const per = Math.ceil(sel.length / targets.length);
    const slots = rallySlots(sel.length);
    sel.forEach((u, idx) => {
      const t = targets[idx % targets.length];
      const slot = slots[idx];
      RTS.Unit.orderAttackMove(u, t.x + slot.x, t.y + slot.y);
    });
    ai.waveElapsed = 0;
  }

  function defend(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const base = enemy.base;
    const radius = C().aiDefenseRadius;
    const slots = rallySlots(enemy.units.size);
    let i = 0;
    enemy.units.forEach((u) => {
      if (u.state !== 'idle' && u.state !== 'move') return;
      const slot = slots[i % slots.length];
      if (RTS.Unit.distTo(u, base.x, base.y) > radius * 2) {
        RTS.Unit.orderAttackMove(u, base.x + slot.x * 0.5, base.y + slot.y * 0.5);
        i++;
        return;
      }
      let nearest = null;
      let nd = Infinity;
      st.player.units.forEach((p) => {
        if (p.hp <= 0) return;
        const d = RTS.Unit.distTo(u, p.x, p.y);
        if (d < nd) { nd = d; nearest = p; }
      });
      if (nearest) RTS.Unit.orderAttack(u, { kind: 'unit', ref: nearest });
      i++;
    });
  }

  function retreatTo(ai, point, spreadMul) {
    const st = RTS.state;
    const units = commandableUnits(st.enemy);
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.orderMove(u, point.x + slot.x * (spreadMul || 0.6), point.y + slot.y * (spreadMul || 0.6));
    });
  }

  function captureType(ai, type) {
    const st = RTS.state;
    const nodes = nodesOf(null).filter((n) => n.type === type && n.owner !== 'enemy');
    if (nodes.length === 0) return;
    nodes.sort((a, b) => RTS.Unit.distTo(a, st.enemy.base.x, st.enemy.base.y) - RTS.Unit.distTo(b, st.enemy.base.x, st.enemy.base.y));
    const targets = nodes.slice(0, 2);
    const units = commandableUnits(st.enemy);
    if (units.length === 0) return;
    assignSquads(units, targets, 3);
  }

  function captureExpand(ai) {
    const st = RTS.state;
    // 抢占离敌方较近、且非己方的节点
    const nodes = nodesOf(null).filter((n) => n.owner !== 'enemy');
    if (nodes.length === 0) return;
    nodes.sort((a, b) => RTS.Unit.distTo(a, st.player.base.x, st.player.base.y) - RTS.Unit.distTo(b, st.player.base.x, st.player.base.y));
    const targets = nodes.slice(0, 2);
    const units = commandableUnits(st.enemy);
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
        if (Math.hypot(u.x - target.x, u.y - target.y) < target.radius * 0.7) continue;
        const off = rallySlots(perSquad)[n];
        RTS.Unit.orderAttackMove(u, target.x + off.x * 0.5, target.y + off.y * 0.5);
        assigned.set(target, n + 1);
        break;
      }
    });
  }

  function garrisonNodes(ai) {
    const st = RTS.state;
    const nodes = nodesOf('enemy');
    if (nodes.length === 0) return;
    const units = commandableUnits(st.enemy);
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 3), 2);
  }

  function scout(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    // 优先骑兵，其次任意单位，派小队前往敌方半场视野点
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    const fast = units.filter((u) => {
      const tags = (RTS.Units.get(u.type) && RTS.Units.get(u.type).tags) || [];
      return tags.includes('fast') || tags.includes('cavalry');
    });
    const squad = (fast.length > 0 ? fast : units).slice(0, C().aiScoutSquad);
    const probeLanes = laneIds();
    const probes = probeLanes.map((l) => ({ x: st.player.base.x - 300, y: laneY(l) }));
    squad.forEach((u, i) => {
      const p = probes[i % probes.length];
      RTS.Unit.orderAttackMove(u, p.x, p.y);
    });
    ai.hasScouted = true;
  }

  function scoutHold(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    const chokepoint = { x: (st.player.base.x + enemy.base.x) / 2, y: laneY('mid') };
    assignAttackMove(units.slice(0, C().aiScoutSquad), [chokepoint]);
  }

  function ambush(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    // 在桥头附近的森林设伏：找最近可通行森林格
    const mid = { x: (st.player.base.x + enemy.base.x) / 2, y: laneY('mid') };
    const ambushPts = [mid];
    assignAttackMove(units.slice(0, 8), ambushPts);
  }

  function focusFire(ai, target) {
    const st = RTS.state;
    const enemy = st.enemy;
    let best = null;
    if (target === 'base') {
      best = { kind: 'base', ref: st.player.base };
    } else {
      let nd = Infinity;
      st.player.units.forEach((p) => {
        if (p.hp <= 0) return;
        const d = RTS.Unit.distTo(p, enemy.base.x, enemy.base.y);
        if (d < nd) { nd = d; best = { kind: 'unit', ref: p }; }
      });
    }
    if (!best) return;
    enemy.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') {
        RTS.Unit.orderAttack(u, best);
      }
    });
  }

  function fallback(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const base = enemy.base;
    // 边打边退：撤到基地与中线之间的重整点
    const staging = { x: base.x + (st.player.base.x - base.x) * 0.4, y: base.y };
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.orderAttackMove(u, staging.x + slot.x, staging.y + slot.y);
    });
  }

  // ------------------------------------------------------------------ DeepSeek

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

    // 动态构建各兵种数量（键为单位 id，随注册表变化）
    const myArmyCounts = {};
    const enemyArmyCounts = {};
    for (const id of RTS.Units.ids()) {
      myArmyCounts[id] = myArmy[id] || 0;
      enemyArmyCounts[id] = enemyArmy[id] || 0;
    }

    const payload = {
      time: Math.round(time),
      stance: ai.phase,
      map: RTS.Maps.current().id,
      myGold: Math.round(enemy.gold),
      myWood: Math.round(enemy.wood),
      myStone: Math.round(enemy.stone),
      myPop: enemy.units.size,
      enemyPop: player.units.size,
      myArmy: myArmyCounts,
      enemyArmy: enemyArmyCounts,
      baseHp: Math.round(enemy.base.hp),
      enemyBaseHp: Math.round(player.base.hp),
      myUpgrades: { attack: enemy.upgrades.attack, armor: enemy.upgrades.armor, defense: enemy.upgrades.defense },
      myNodes: nodesOf('enemy').length,
      enemyNodes: nodesOf('player').length,
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
    ai.deepseekEverActive = true;
    ai.lastDeepseekError = null;
    ai.lastDecision = decision;
    if (decision.armyFocus) ai.strategy.armyFocus = decision.armyFocus;
    if (typeof decision.aggression === 'number') {
      ai.strategy.aggression = Math.max(0, Math.min(100, decision.aggression));
    }
    // v4：态势完全由 DeepSeek 决定（直接切换 phase，不再有规则层参与）
    if (decision.stance && STANCE_LIST.includes(decision.stance)) {
      setPhase(ai, decision.stance, time);
    }
    if (decision.lane && LANE_LIST.includes(decision.lane)) ai.strategy.lane = decision.lane;
    if (decision.targetFocus && TARGET_LIST.includes(decision.targetFocus)) ai.strategy.targetFocus = decision.targetFocus;

    if (decision.attackNow) {
      ai.nextAttackTime = time;
      const mine = countArmy(RTS.state.enemy);
      setPhase(ai, mine.total >= C().aiArmyThreshold ? PHASE.all_in : PHASE.rally, time);
    }
    if (RTS.state.debugMode) {
      RTS.UI.toast('AI 决策：' + (decision.comment || decision.stance || decision.armyFocus || '—'), 'info');
    }
  }

  // ------------------------------------------------------------------ 每帧更新

  function update(dt) {
    const st = RTS.state;
    const ai = st.ai;
    const time = st.time;
    const enemy = st.enemy;

    maybeRequestDeepSeek(ai, time);

    // v4：DeepSeek 尚未成功接管前，用极简降级自动驾驶保底（接管后规则永不再参与）
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

    // 3) 按态势执行低层指令
    executePhase(ai, enemy, time);

    // 清空“相位切换”标记（DeepSeek 异步 attackNow 设置的 phaseChanged 已消费）
    ai.phaseChanged = false;

    // 4) 总攻波计时衰减
    if (ai.phase === PHASE.assault_mid || ai.phase === PHASE.assault_top ||
        ai.phase === PHASE.assault_bottom || ai.phase === PHASE.all_in ||
        ai.phase === PHASE.pincer || ai.phase === PHASE.siege) {
      ai.waveElapsed += dt;
    }
  }

  function executePhase(ai, enemy, time) {
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
        if (throttle()) { retreatTo(ai, enemy.base, 0.7); ai.commandTimer = 2; }
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
          attackLanes(ai, false, ['mid']);
          const aggr = ai.strategy.aggression / 100;
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMax - aggr * (Cfg.aiAttackCooldownMax - Cfg.aiAttackCooldownMin);
        }
        break;
      case PHASE.harass_flank:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          const lane = Math.random() < 0.5 ? 'top' : 'bottom';
          attackLanes(ai, false, [lane]);
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
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['mid']);
        break;
      case PHASE.assault_top:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top']);
        break;
      case PHASE.assault_bottom:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['bottom']);
        break;
      case PHASE.all_in:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'mid', 'bottom']);
        break;
      case PHASE.pincer:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'bottom']);
        break;
      case PHASE.feint:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) {
          attackLanes(ai, false, [ai.feintLane]);
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
          attackLanes(ai, false, ['mid']);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        }
        break;
      case PHASE.fallback:
        if (throttle()) { fallback(ai); ai.commandTimer = 2; }
        break;

      // ---------------- 撤退 / 重整
      case PHASE.retreat:
        if (throttle()) { retreatTo(ai, enemy.base, 0.6); ai.commandTimer = 1.5; }
        break;
      case PHASE.regroup:
        if (ai.phaseChanged || ai.commandTimer <= 0) {
          retreatTo(ai, ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai), 0.8);
          ai.commandTimer = 2;
        }
        break;
      case PHASE.turtle:
        if (throttle()) { retreatTo(ai, enemy.base, 0.9); ai.commandTimer = 1.5; }
        break;
      case PHASE.ambush:
        if (ai.phaseChanged) ambush(ai);
        break;
    }
  }

  function raidEcon(ai) {
    const st = RTS.state;
    const nodes = nodesOf('player'); // 敌方（AI）视角：player 占的节点是劫掠目标
    if (nodes.length === 0) return;
    const units = commandableUnits(st.enemy);
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 4);
  }

  function defendChoke(ai) {
    const st = RTS.state;
    const enemy = st.enemy;
    const base = enemy.base;
    // 在己方一侧的各通道桥头布防（通道来自地图定义）
    const dirX = st.player.base.x > base.x ? 1 : -1;
    const chokepoints = laneIds().map((l) => ({ x: base.x + dirX * 220, y: laneY(l) }));
    const units = commandableUnits(enemy);
    if (units.length === 0) return;
    assignAttackMove(units, chokepoints);
  }

  return { init, update, countArmy, PHASE, PHASE_LABEL, STANCE_LIST };
})();
