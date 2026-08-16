'use strict';

/**
 * ai.js — 指挥官 AI（v15：三层指挥链——主将/军团长/队长）
 *
 * v15 架构：
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 主将 general（大模型，~20s）：战略意图 + 生产决策                    │
 * │   stance / aggression / lane / targetFocus / attackNow / armyFocus  │
 * │   + corpsDirectives[]（给每个军团长的一句话指令）                     │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 军团长 corps_commander（大模型，7-10s/军团）                         │
 * │   自动分配：1 默认，每50人+1个，最多4个                              │
 * │   管理均衡混编军团，发布抽象战术指令                                  │
 * │   orders[]：{unitType, action, lane?, point?}                        │
 * │   action: gather/advance/attack/retreat/defend/scatter/flank/hold    │
 * │           phalanx/shield_wall/protect_flanks/kite/charge             │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 队长 squad_leader（确定性逻辑，持续执行）                             │
 * │   每个军团内每个兵种一个队长                                         │
 * │   翻译抽象指令为具体单位命令（编队系统）                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 无 Key / 网络失败时：主将降级为极简自动驾驶；军团长不启动，
 * 39 态态势执行器作为「参谋部兜底」继续指挥。
 */

RTS.AI = (function () {
  const C = () => RTS.CONFIG;

  // ------------------------------------------------------------------ 状态枚举（39 态）
  const PHASE = {
    // 经济
    build: 'build',
    boom: 'boom',
    tech: 'tech',
    eco_defend: 'eco_defend',
    fortify: 'fortify',
    // 侦查
    scout: 'scout',
    scout_hold: 'scout_hold',
    counter_scout: 'counter_scout',
    // 地图控制
    capture_gold: 'capture_gold',
    capture_wood: 'capture_wood',
    capture_stone: 'capture_stone',
    capture_expand: 'capture_expand',
    node_garrison: 'node_garrison',
    // 集结
    rally: 'rally',
    rally_hold: 'rally_hold',
    reinforce: 'reinforce',
    // 骚扰
    harass: 'harass',
    harass_flank: 'harass_flank',
    harass_econ: 'harass_econ',
    // 进攻
    assault_mid: 'assault_mid',
    assault_top: 'assault_top',
    assault_bottom: 'assault_bottom',
    all_in: 'all_in',
    pincer: 'pincer',
    feint: 'feint',
    siege: 'siege',
    // 防守
    defend: 'defend',
    defend_choke: 'defend_choke',
    defend_node: 'defend_node',
    counter_attack: 'counter_attack',
    fallback: 'fallback',
    // 撤退 / 重整
    retreat: 'retreat',
    regroup: 'regroup',
    turtle: 'turtle',
    ambush: 'ambush',
    // v10 新增态势
    guerrilla: 'guerrilla',
    priority_defense: 'priority_defense',
    sneak: 'sneak',
    hold_line: 'hold_line',
  };

  const PHASE_LABEL = {
    build: '发育', boom: '爆兵', tech: '科技', eco_defend: '经济防守', fortify: '筑垒',
    scout: '侦查', scout_hold: '侦查驻守', counter_scout: '反侦察',
    capture_gold: '占金矿', capture_wood: '占伐木场', capture_stone: '占采石场',
    capture_expand: '前哨扩张', node_garrison: '资源驻守',
    rally: '集结', rally_hold: '集结待命', reinforce: '增援前线',
    harass: '试探', harass_flank: '侧翼骚扰', harass_econ: '劫掠经济',
    assault_mid: '中路总攻', assault_top: '上路总攻', assault_bottom: '下路总攻',
    all_in: '倾巢一击', pincer: '钳形夹击', feint: '佯攻', siege: '围城',
    defend: '回防', defend_choke: '隘口防守', defend_node: '资源防守',
    counter_attack: '防守反击', fallback: '有序后撤',
    retreat: '撤退', regroup: '重整', turtle: '龟缩', ambush: '伏击',
    guerrilla: '游击', priority_defense: '重点防守', sneak: '偷家', hold_line: '防线推进',
  };

  const STANCE_LIST = Object.values(PHASE);
  const LANE_LIST = ['top', 'mid', 'bottom'];
  const TARGET_LIST = ['base', 'army', 'econ'];

  // v15：指挥链角色中文名
  const ROLE_LABEL = {
    general: '主将',
    corps_commander: '军团长',
  };

  // v15：军团长可发布的抽象动作白名单
  const CORPS_ACTIONS = [
    'gather', 'advance', 'attack', 'retreat', 'defend', 'scatter',
    'flank', 'hold', 'phalanx', 'shield_wall', 'protect_flanks', 'kite', 'charge',
  ];

  const URGENT_STANCES = new Set([
    PHASE.defend, PHASE.defend_choke, PHASE.defend_node,
    PHASE.counter_attack, PHASE.counter_scout, PHASE.fallback,
    PHASE.retreat, PHASE.regroup, PHASE.turtle,
  ]);

  // ------------------------------------------------------------------ 阵营取用

  function mine(ai) { return RTS.state[ai.owner]; }
  function theirs(ai) { return RTS.state[ai.owner === 'player' ? 'enemy' : 'player']; }
  function basesOf(faction) { return (faction.bases && faction.bases.length) ? faction.bases : [faction.base]; }

  function armyAdvantage(ai) {
    return countArmy(mine(ai)).total - countArmy(theirs(ai)).total;
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

  function laneY(lane) {
    const map = RTS.Maps.current();
    const laneDef = (map.lanes || []).find((l) => l.id === lane);
    if (laneDef) return laneDef.ty * C().tileSize;
    return C().worldHeight / 2;
  }

  function laneTarget(ai, lane) {
    const y = laneY(lane);
    const oppBases = aliveBasesOf(theirs(ai));
    let best = oppBases[0];
    let bd = Infinity;
    for (const b of oppBases) {
      const d = Math.abs(b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    return { x: best.x, y: best.y };
  }

  function laneIds() {
    const map = RTS.Maps.current();
    return (map.lanes && map.lanes.length ? map.lanes : [{ id: 'mid' }]).map((l) => l.id);
  }

  function aliveBasesOf(faction) {
    const all = basesOf(faction);
    const alive = all.filter((b) => !b.destroyed && b.hp > 0);
    return alive.length > 0 ? alive : all;
  }

  function intruderCount(ai) {
    const myBases = aliveBasesOf(mine(ai));
    let n = 0;
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      for (const b of myBases) {
        if (RTS.Unit.distTo(u, b.x, b.y) < C().aiDefenseRadius) { n++; break; }
      }
    });
    return n;
  }

  function intrudersNear(ai, x, y, r) {
    const out = [];
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      if (RTS.Unit.distTo(u, x, y) < r) out.push(u);
    });
    return out;
  }

  function nearestIntruder(ai) {
    const myBases = aliveBasesOf(mine(ai));
    let best = null;
    let bd = Infinity;
    theirs(ai).units.forEach((u) => {
      if (u.hp <= 0) return;
      for (const b of myBases) {
        const d = RTS.Unit.distTo(u, b.x, b.y);
        if (d < bd) { bd = d; best = u; }
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ v15：初始化

  function init(owner, provider) {
    const Cfg = C();
    return {
      owner: owner || 'enemy',
      provider: provider || 'deepseek',
      phase: PHASE.build,
      phaseEnterTime: 0,
      phaseChanged: false,
      lastStanceChangeTime: -9999,

      productionTimer: 0,
      productionInterval: 1.5,
      defenseTimer: 0,
      commandTimer: 0,
      squadTimer: 0,
      fortifyTimer: 0,

      // 主将（general）：大模型战略决策
      deepseekNextAt: 0,
      deepseekBusy: false,
      deepseekActive: false,
      deepseekEverActive: false,
      lastDecision: null,
      lastDeepseekError: null,
      deepseekCount: 0,

      // v15：军团（corps）——动态管理
      corps: [],
      corpsReassignTimer: 0, // 军团重组检查计时器
      squadLeaderTimer: 0, // v15：队长执行间隔计时器（每10秒执行一次战术动作）

      // 指挥官意志（由大模型注入）
      strategy: {
        armyFocus: null,
        aggression: Cfg.aiBaseAggression,
        lane: null,
        targetFocus: null,
        squad: null,
        corpsDirectives: [], // v15：给军团长的指令数组
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
      queueCongestionTime: 0,
    };
  }

  // ------------------------------------------------------------------ v15：军团管理

  /**
   * v15：初始化或重组军团
   * 根据单位总数决定军团数量：1-50人=1军团，51-100人=2军团，101-150人=3军团，最多4个
   * 单位按兵种均衡分配到各军团
   */
  function initCorps(ai) {
    const controlled = mine(ai);
    const Cfg = C();
    const totalUnits = controlled.units.size;
    const corpsSize = Cfg.aiCorpsSizeThreshold || 50;
    const maxCorps = Cfg.aiMaxCorps || 4;
    
    // 计算需要的军团数
    const numCorps = Math.min(maxCorps, Math.max(1, Math.ceil(totalUnits / corpsSize)));
    
    // 清理旧军团
    ai.corps = [];
    
    // 按兵种分组单位
    const unitsByType = {};
    controlled.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (!unitsByType[u.type]) unitsByType[u.type] = [];
      unitsByType[u.type].push(u);
    });
    
    // 初始化新军团
    for (let i = 0; i < numCorps; i++) {
      ai.corps.push({
        id: i,
        unitIds: new Set(), // 该军团包含的单位ID
        commander: {
          nextAt: 0,
          busy: false,
          active: false,
          count: 0,
          error: null,
          currentOrders: [], // 当前的抽象战术指令
          receivedAt: -999,
        },
        // 每个兵种的队长状态（确定性执行）
        squadStates: {},
      });
    }
    
    // 按兵种轮转分配到各军团（保证每个军团都有均衡的兵种）
    let corpsIdx = 0;
    const typeIds = Object.keys(unitsByType);
    for (const type of typeIds) {
      const units = unitsByType[type];
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const corps = ai.corps[corpsIdx % numCorps];
        corps.unitIds.add(unit.id);
        corpsIdx++;
      }
    }
    
    // 初始化每个军团的队长状态
    for (const corps of ai.corps) {
      for (const type of typeIds) {
        corps.squadStates[type] = {
          action: null,
          targetX: 0,
          targetY: 0,
          targetLane: null,
          updatedAt: 0,
        };
      }
    }
  }

  /**
   * v15：获取单位所属的军团
   */
  function getCorpsForUnit(ai, unitId) {
    for (const corps of ai.corps) {
      if (corps.unitIds.has(unitId)) return corps;
    }
    return null;
  }

  /**
   * v15：获取军团内的单位列表
   */
  function getCorpsUnits(corps) {
    const controlled = mine(RTS.state.ai); // 通用取法
    const units = [];
    corps.unitIds.forEach((id) => {
      const u = RTS.state.player.units.get(id) || RTS.state.enemy.units.get(id);
      if (u && u.hp > 0) units.push(u);
    });
    return units;
  }

  /**
   * v15：获取军团内特定兵种的单位
   */
  function getCorpsUnitsOfType(corps, type) {
    const units = [];
    corps.unitIds.forEach((id) => {
      const faction = mine(RTS.state.ai);
      const u = faction.units.get(id);
      if (u && u.hp > 0 && u.type === type) units.push(u);
    });
    return units;
  }

  /**
   * v15：重组军团——当单位数量变化较大时重新分配
   */
  function maybeReassignCorps(ai, time) {
    const Cfg = C();
    const corpsSize = Cfg.aiCorpsSizeThreshold || 50;
    const maxCorps = Cfg.aiMaxCorps || 4;
    
    ai.corpsReassignTimer -= Cfg.aiCorpsReassignInterval || 10;
    if (ai.corpsReassignTimer > 0) return;
    ai.corpsReassignTimer = Cfg.aiCorpsReassignInterval || 10;
    
    const controlled = mine(ai);
    const totalUnits = controlled.units.size;
    const currentCorps = ai.corps.length;
    const neededCorps = Math.min(maxCorps, Math.max(1, Math.ceil(totalUnits / corpsSize)));
    
    // 如果军团数量需要变化，或者有大量单位死亡/新增，重新初始化
    if (neededCorps !== currentCorps || shouldRebalanceCorps(ai)) {
      initCorps(ai);
    } else {
      // 清理死亡单位
      for (const corps of ai.corps) {
        const toRemove = [];
        corps.unitIds.forEach((id) => {
          const u = controlled.units.get(id);
          if (!u || u.hp <= 0) toRemove.push(id);
        });
        toRemove.forEach((id) => corps.unitIds.delete(id));
      }
      
      // 把未分配的单位分配到军团
      const assigned = new Set();
      for (const corps of ai.corps) {
        corps.unitIds.forEach((id) => assigned.add(id));
      }
      controlled.units.forEach((u) => {
        if (u.hp > 0 && !assigned.has(u.id)) {
          // 找最小的军团加入
          let minCorps = ai.corps[0];
          for (const c of ai.corps) {
            if (c.unitIds.size < minCorps.unitIds.size) minCorps = c;
          }
          minCorps.unitIds.add(u.id);
        }
      });
    }
  }

  /**
   * v15：判断是否需要重组军团（某军团单位数过少或过多）
   */
  function shouldRebalanceCorps(ai) {
    if (ai.corps.length <= 1) return false;
    const sizes = ai.corps.map((c) => c.unitIds.size);
    const avg = sizes.reduce((s, n) => s + n, 0) / sizes.length;
    // 如果某个军团单位数偏差超过50%，需要重组
    for (const size of sizes) {
      if (Math.abs(size - avg) > avg * 0.5) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ v15：军团长请求

  /**
   * v15：构建军团长请求载荷
   */
  function buildCorpsCommanderPayload(ai, corps, time) {
    const controlled = mine(ai);
    const opponent = theirs(ai);
    const myArmy = countArmy(controlled);
    const opponentArmy = countArmy(opponent);
    
    // 获取军团内的单位
    const corpsUnits = [];
    const corpsUnitCounts = {};
    for (const id of RTS.Units.ids()) corpsUnitCounts[id] = 0;
    
    corps.unitIds.forEach((id) => {
      const u = controlled.units.get(id);
      if (u && u.hp > 0) {
        corpsUnits.push({
          id: u.id, type: u.type,
          x: Math.round(u.x), y: Math.round(u.y),
          state: u.state, hp: Math.round(u.hp),
        });
        corpsUnitCounts[u.type] = (corpsUnitCounts[u.type] || 0) + 1;
      }
    });
    
    // 获取附近的敌人
    const nearbyEnemies = [];
    const corpsCenter = getCorpsCenter(corps);
    opponent.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (RTS.Unit.distTo(u, corpsCenter.x, corpsCenter.y) < 600) {
        nearbyEnemies.push({
          id: u.id, type: u.type,
          x: Math.round(u.x), y: Math.round(u.y),
          hp: Math.round(u.hp),
        });
      }
    });
    
    // 获取主将给该军团的指令
    const directive = ai.strategy.corpsDirectives[corps.id] || '';
    
    return {
      side: ai.owner,
      provider: ai.provider,
      role: 'corps_commander',
      corpsId: corps.id,
      time: Math.round(time),
      map: RTS.Maps.current().id,
      stance: ai.phase,
      // 军团信息
      corpsUnitCounts: corpsUnitCounts,
      corpsTotalUnits: corpsUnits.length,
      corpsUnits: corpsUnits.slice(0, 20), // 控制token
      corpsCenter: { x: Math.round(corpsCenter.x), y: Math.round(corpsCenter.y) },
      // 主将指令
      generalDirective: directive,
      // 战场信息
      myArmy: armyCountsObj(myArmy),
      enemyArmy: armyCountsObj(opponentArmy),
      nearbyEnemies: nearbyEnemies.slice(0, 10),
      // 路线信息
      lanes: laneIds().map((l) => ({
        id: l,
        x: Math.round(laneTarget(ai, l).x),
        y: Math.round(laneY(l)),
      })),
      myBase: { x: Math.round(controlled.base.x), y: Math.round(controlled.base.y) },
      enemyBase: { x: Math.round(opponent.base.x), y: Math.round(opponent.base.y) },
    };
  }

  /**
   * v15：获取军团中心点
   */
  function getCorpsCenter(corps) {
    let sumX = 0, sumY = 0, count = 0;
    corps.unitIds.forEach((id) => {
      const faction = mine(RTS.state.ai);
      const u = faction.units.get(id);
      if (u && u.hp > 0) {
        sumX += u.x;
        sumY += u.y;
        count++;
      }
    });
    return count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
  }

  /**
   * v15：请求军团长决策
   */
  function requestCorpsCommander(ai, corps, time) {
    const payload = buildCorpsCommanderPayload(ai, corps, time);
    const doFetch = typeof fetch === 'function' ? fetch : null;
    if (!doFetch) {
      markCorpsCommanderError(corps, 'no_fetch');
      scheduleCorpsCommanderNext(corps, time);
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
          applyCorpsCommanderDecision(ai, corps, data.decision, time);
        } else {
          markCorpsCommanderError(corps, (data && data.reason) || 'no_key');
        }
      })
      .catch(() => {
        markCorpsCommanderError(corps, 'network_error');
      })
      .finally(() => {
        scheduleCorpsCommanderNext(corps, time);
      });
  }

  function markCorpsCommanderError(corps, reason) {
    corps.commander.error = reason;
    corps.commander.currentOrders = [];
  }

  function scheduleCorpsCommanderNext(corps, time) {
    corps.commander.busy = false;
    const Cfg = C();
    const min = Cfg.aiCorpsCommanderIntervalMin || 7;
    const max = Cfg.aiCorpsCommanderIntervalMax || 10;
    corps.commander.nextAt = time + min + Math.random() * (max - min);
    corps.commander.count++;
  }

  /**
   * v15：应用军团长决策
   */
  function applyCorpsCommanderDecision(ai, corps, decision, time) {
    corps.commander.active = true;
    corps.commander.error = null;
    corps.commander.receivedAt = time;
    
    // 应用抽象战术指令
    if (decision.orders && Array.isArray(decision.orders)) {
      corps.commander.currentOrders = decision.orders.filter((o) => 
        o && o.unitType && o.action && CORPS_ACTIONS.includes(o.action)
      );
      // 立即执行队长翻译
      executeCorpsOrders(ai, corps, time);
      // 设置队长下次执行时间（10秒后）
      corps.commander.nextSquadExecute = time + (C().aiSquadLeaderInterval || 10);
    }
    
    // 显示决策消息
    const text = decision.comment || ('军团' + (corps.id + 1) + '下达' + (corps.commander.currentOrders.length) + '条指令');
    if (text && RTS.UI && RTS.UI.aiMessage) {
      RTS.UI.aiMessage(ai.owner, '【军团长' + (corps.id + 1) + '】' + text);
    }
  }

  // ------------------------------------------------------------------ v15：队长执行（确定性翻译）

  /**
   * v15：执行军团的抽象战术指令
   * 遍历每个指令，找到对应的单位，翻译为具体命令
   */
  function executeCorpsOrders(ai, corps, time) {
    const controlled = mine(ai);
    const Cfg = C();
    
    for (const order of corps.commander.currentOrders) {
      const unitType = order.unitType;
      const action = order.action;
      const lane = order.lane;
      const point = order.point;
      
      // 获取该兵种的单位
      const units = [];
      corps.unitIds.forEach((id) => {
        const u = controlled.units.get(id);
        if (u && u.hp > 0 && (unitType === 'all' || u.type === unitType)) {
          // 不打断已有微指令的单位
          if (!RTS.Unit.microActive(u)) units.push(u);
        }
      });
      
      if (units.length === 0) continue;
      
      // 翻译抽象动作为具体命令
      translateAction(ai, corps, units, action, lane, point, time);
    }
  }

  /**
   * v15：翻译抽象动作为具体单位命令
   */
  function translateAction(ai, corps, units, action, lane, point, time) {
    const controlled = mine(ai);
    const opponent = theirs(ai);
    const Cfg = C();
    
    // 计算目标点
    let targetX = 0, targetY = 0;
    const corpsCenter = getCorpsCenter(corps);
    
    switch (action) {
      case 'gather': {
        // 聚集到指定点或军团中心
        if (point) {
          targetX = point.x; targetY = point.y;
        } else {
          targetX = corpsCenter.x; targetY = corpsCenter.y;
        }
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, targetX, targetY, { arriveDelay: true });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, targetX, targetY));
        }
        break;
      }
      
      case 'advance': {
        // 向敌方推进（沿指定路线或默认中路）
        const targetLane = lane || 'mid';
        const target = laneTarget(ai, targetLane);
        const midX = (controlled.base.x + opponent.base.x) / 2;
        targetX = midX + (target.x - midX) * 0.5;
        targetY = laneY(targetLane);
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, targetX, targetY, { arriveDelay: true });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, targetX, targetY));
        }
        break;
      }
      
      case 'attack': {
        // 全力进攻敌方
        const targetLane = lane || 'mid';
        const target = laneTarget(ai, targetLane);
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, target.x, target.y, { arriveDelay: true });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, target.x, target.y));
        }
        break;
      }
      
      case 'retreat': {
        // 撤退到我方基地
        const base = controlled.base;
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, base.x, base.y, {
            useAttackMove: false, arriveDelay: false,
          });
        } else {
          units.forEach((u) => RTS.Unit.orderMove(u, base.x, base.y));
        }
        break;
      }
      
      case 'defend': {
        // 防守指定位置或基地附近
        if (point) {
          targetX = point.x; targetY = point.y;
        } else {
          const base = controlled.base;
          const dirX = opponent.base.x > base.x ? 1 : -1;
          targetX = base.x + dirX * 200;
          targetY = base.y;
        }
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, targetX, targetY, { arriveDelay: true });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, targetX, targetY));
        }
        break;
      }
      
      case 'scatter': {
        // 分散开来（避免集火），每个单位随机偏移
        units.forEach((u) => {
          const offsetX = (Math.random() - 0.5) * 300;
          const offsetY = (Math.random() - 0.5) * 300;
          RTS.Unit.orderAttackMove(u, u.x + offsetX, u.y + offsetY);
        });
        break;
      }
      
      case 'flank': {
        // 侧翼移动（绕到敌方侧翼）
        const targetLane = lane || 'top';
        const target = laneTarget(ai, targetLane);
        const dirX = opponent.base.x > controlled.base.x ? 1 : -1;
        // 绕到侧翼：先到中线偏移位置，再到目标
        const flankX = (controlled.base.x + opponent.base.x) / 2;
        const flankY = laneY(targetLane) + (targetLane === 'top' ? -200 : 200);
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, flankX, flankY, { arriveDelay: true });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, flankX, flankY));
        }
        break;
      }
      
      case 'hold': {
        // 待命不动（驻守当前位置）
        units.forEach((u) => {
          u.holdX = u.x;
          u.holdY = u.y;
        });
        break;
      }
      
      case 'phalanx': {
        // 长矛方阵推进（紧密阵型向前推进）
        const targetLane = lane || 'mid';
        const target = laneTarget(ai, targetLane);
        // 使用编队系统，紧密排列
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, target.x, target.y, {
            arriveDelay: true,
            tightFormation: true, // 紧密阵型
          });
        } else {
          // 兜底：手动密集排列
          const spacing = 20;
          const cols = Math.ceil(Math.sqrt(units.length));
          units.forEach((u, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const sx = target.x + (col - cols / 2) * spacing;
            const sy = target.y + row * spacing;
            RTS.Unit.orderAttackMove(u, sx, sy);
          });
        }
        break;
      }
      
      case 'shield_wall': {
        // 盾墙防御（刀盾兵/肉盾前排紧密排列）
        const base = controlled.base;
        const dirX = opponent.base.x > base.x ? 1 : -1;
        targetX = corpsCenter.x + dirX * 50;
        targetY = corpsCenter.y;
        // 紧密横向排列
        const spacing = 18;
        const halfWidth = (units.length * spacing) / 2;
        units.forEach((u, i) => {
          const sx = targetX;
          const sy = targetY - halfWidth + i * spacing;
          RTS.Unit.orderAttackMove(u, sx, sy);
        });
        break;
      }
      
      case 'protect_flanks': {
        // 骑兵保护侧翼：移动到军团两翼
        const dirX = opponent.base.x > controlled.base.x ? 1 : -1;
        const leftFlank = { x: corpsCenter.x, y: corpsCenter.y - 160 };
        const rightFlank = { x: corpsCenter.x, y: corpsCenter.y + 160 };
        const half = Math.ceil(units.length / 2);
        units.slice(0, half).forEach((u) => {
          RTS.Unit.orderAttackMove(u, leftFlank.x, leftFlank.y);
        });
        units.slice(half).forEach((u) => {
          RTS.Unit.orderAttackMove(u, rightFlank.x, rightFlank.y);
        });
        break;
      }
      
      case 'kite': {
        // 远程风筝后退：边退边射
        const base = controlled.base;
        const retreatX = (corpsCenter.x + base.x) / 2;
        const retreatY = corpsCenter.y;
        if (RTS.Formations) {
          RTS.Formations.formationAttackMove(units, retreatX, retreatY, {
            useAttackMove: true, // 边退边打
            arriveDelay: false,
          });
        } else {
          units.forEach((u) => RTS.Unit.orderAttackMove(u, retreatX, retreatY));
        }
        break;
      }
      
      case 'charge': {
        // 骑兵冲锋：快速冲向敌人
        const targetLane = lane || 'mid';
        const target = laneTarget(ai, targetLane);
        // 直接冲向目标，不使用编队（速度优先）
        units.forEach((u) => {
          RTS.Unit.orderAttackMove(u, target.x, target.y);
          // 标记冲锋状态（利用现有的移动速度加成）
          if (u._chargeBonus === undefined) u._chargeBonus = true;
        });
        break;
      }
    }
    
    // 更新队长状态
    const squadState = corps.squadStates[units[0]?.type] || {};
    squadState.action = action;
    squadState.targetX = targetX;
    squadState.targetY = targetY;
    squadState.targetLane = lane;
    squadState.updatedAt = time;
  }

  // ------------------------------------------------------------------ 生产

  function decideProductionType(ai, opponentArmy) {
    const ids = RTS.Units.ids();
    const weights = {};
    for (const id of ids) {
      const def = RTS.Units.get(id);
      weights[id] = (def.ai && def.ai.weight) || 1;
    }

    if (ai.strategy.armyFocus && RTS.Units.has(ai.strategy.armyFocus)) {
      weights[ai.strategy.armyFocus] += 20;
    }

    if (ai.strategy.targetFocus === 'base') {
      for (const id of ids) {
        const tags = (RTS.Units.get(id).tags || []);
        if (tags.includes('tank')) weights[id] += 10;
        if (tags.includes('siege')) weights[id] += 8;
        if (tags.includes('cavalry') || tags.includes('fast')) weights[id] += 6;
        if (tags.includes('ranged')) weights[id] += 3;
      }
    } else if (ai.strategy.targetFocus === 'econ') {
      for (const id of ids) {
        const tags = (RTS.Units.get(id).tags || []);
        if (tags.includes('fast') || tags.includes('cavalry')) weights[id] += 5;
      }
    }

    const offensivePhase =
      ai.phase === PHASE.siege || ai.phase === PHASE.all_in ||
      ai.phase === PHASE.assault_mid || ai.phase === PHASE.assault_top ||
      ai.phase === PHASE.assault_bottom || ai.phase === PHASE.pincer ||
      ai.phase === PHASE.sneak || ai.phase === PHASE.feint;
    if (offensivePhase) {
      weights.wall = (weights.wall || 1) + 8;
      weights.hammer = (weights.hammer || 1) + 6;
    } else if (ai.phase === PHASE.fortify) {
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

  function scoutCapOk(controlled) {
    const limit = C().aiMaxScouts;
    let inField = 0;
    controlled.units.forEach((u) => { if (u.hp > 0 && u.type === 'scout') inField++; });
    let inQueue = 0;
    for (const q of controlled.productionQueue) if (q.type === 'scout') inQueue++;
    return (inField + inQueue) < limit;
  }

  function produce(ai, boost) {
    const controlled = mine(ai);
    const Cfg = C();
    
    // v10.2：人口 ≥85% 时优先补建筑师
    if (controlled.units.size >= Cfg.populationCap * 0.85 &&
        architectNeeded(ai) &&
        !controlled.productionQueue.some((q) => q.type === 'architect')) {
      const ac = RTS.Production.canOrder(controlled, 'architect');
      if (ac.ok) RTS.Production.order(controlled, 'architect');
    }
    
    const budget = boost ? 4 : 2;
    const bases = controlled.bases || [controlled.base];
    
    // v15：按基地轮转出兵，使用主将的生产策略
    let produced = 0;
    for (let bi = 0; bi < bases.length && produced < budget; bi++) {
      if (bases[bi].destroyed || bases[bi].hp <= 0) continue;
      
      let type = decideProductionType(ai, countArmy(theirs(ai)));
      if (type === 'scout' && !scoutCapOk(controlled)) continue;
      if (!type) continue;
      const check = RTS.Production.canOrder(controlled, type);
      if (!check.ok) continue;
      RTS.Production.order(controlled, type, bi);
      produced++;
    }
  }

  // ------------------------------------------------------------------ 科技升级

  function aiUpgrade(ai) {
    const controlled = mine(ai);
    if (RTS.Resources.canUpgrade(controlled, 'defense').ok) {
      RTS.Resources.upgrade(controlled, 'defense');
      return;
    }
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
    const s = RTS.Resources.canUpgrade(controlled, 'siegecraft');
    if (s.ok) {
      RTS.Resources.upgrade(controlled, 'siegecraft');
      return;
    }
    const mob = RTS.Resources.canUpgrade(controlled, 'mobility');
    if (mob.ok) RTS.Resources.upgrade(controlled, 'mobility');
  }

  // ------------------------------------------------------------------ 低层指令

  function microReserved(u) { return RTS.Unit.microActive(u); }

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

  function squadTypeOf(ai) {
    const sq = ai.strategy && ai.strategy.squad;
    return (sq && sq.type && RTS.Units.has(sq.type)) ? sq.type : null;
  }

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

  function assignAttackMove(units, points, reachMul) {
    if (units.length === 0) return;
    if (!RTS.Formations) {
      const tol = C().formationSpacing * (reachMul || 0.9);
      units.forEach((u, i) => {
        const pt = points[i % points.length];
        if (u.orderTarget && Math.hypot(u.orderTarget.x - pt.x, u.orderTarget.y - pt.y) < tol) return;
        if (Math.hypot(u.x - pt.x, u.y - pt.y) < tol) return;
        RTS.Unit.orderAttackMove(u, pt.x, pt.y);
      });
      return;
    }
    if (points.length === 1) {
      RTS.Formations.formationAttackMove(units, points[0].x, points[0].y, { arriveDelay: true });
    } else {
      const perGroup = Math.ceil(units.length / points.length);
      for (let i = 0; i < points.length; i++) {
        const group = units.slice(i * perGroup, (i + 1) * perGroup);
        if (group.length > 0) {
          RTS.Formations.formationAttackMove(group, points[i].x, points[i].y, { arriveDelay: true });
        }
      }
    }
  }

  function rally(ai) {
    if (!ai.rallyPoint || !ai.rallyPoint.x) ai.rallyPoint = rallyPointOf(ai);
    const units = freeUnits(mine(ai), squadTypeOf(ai));
    if (units.length === 0) return;
    RTS.Formations.formationAttackMove(units, ai.rallyPoint.x, ai.rallyPoint.y, { arriveDelay: true });
    ai.rallyTimer = 2.5;
  }

  function attackLanes(ai, fullCommit, lanes, force) {
    const excl = squadTypeOf(ai);
    const units = force ? recallUnits(mine(ai), true, excl, true) : freeUnits(mine(ai), excl);
    if (units.length === 0) return;
    if (force) units.forEach((u) => RTS.Unit.clearMicro(u));
    const strikeCap = fullCommit ? units.length : Math.max(1, Math.floor(units.length * 0.75));
    const targets = lanes.map((l) => laneTarget(ai, l));
    const sel = units.slice(0, strikeCap);

    if (targets.length === 1) {
      RTS.Formations.formationAttackMove(sel, targets[0].x, targets[0].y, {
        forceClear: force, arriveDelay: true,
      });
    } else {
      const perLane = Math.ceil(sel.length / targets.length);
      for (let i = 0; i < targets.length; i++) {
        const group = sel.slice(i * perLane, (i + 1) * perLane);
        if (group.length > 0) {
          RTS.Formations.formationAttackMove(group, targets[i].x, targets[i].y, {
            forceClear: force, arriveDelay: true,
          });
        }
      }
    }
    ai.waveElapsed = 0;
  }

  function defend(ai) {
    const controlled = mine(ai);
    const myBases = aliveBasesOf(controlled);
    let base = controlled.base;
    let bestThreat = -1;
    for (const b of myBases) {
      let t = 0;
      theirs(ai).units.forEach((p) => {
        if (p.hp > 0 && RTS.Unit.distTo(p, b.x, b.y) < C().aiDefenseRadius) t++;
      });
      if (t > bestThreat) { bestThreat = t; base = b; }
    }
    const radius = C().aiDefenseRadius;
    const urgent = intruderCount(ai) >= C().aiDefenseIntruders;
    const units = recallUnits(controlled, false, squadTypeOf(ai), urgent);

    const farUnits = [];
    const nearUnits = [];
    for (const u of units) {
      if (urgent) RTS.Unit.clearMicro(u);
      if (RTS.Unit.distTo(u, base.x, base.y) > radius * 2) farUnits.push(u);
      else nearUnits.push(u);
    }

    if (farUnits.length > 0) {
      const dirX = theirs(ai).base.x > base.x ? 1 : -1;
      RTS.Formations.formationAttackMove(farUnits, base.x + dirX * radius * 0.4, base.y, {
        arriveDelay: true,
      });
    }

    for (const u of nearUnits) {
      let nearest = null;
      let nd = Infinity;
      theirs(ai).units.forEach((p) => {
        if (p.hp <= 0) return;
        const d = RTS.Unit.distTo(u, p.x, p.y);
        if (d < nd) { nd = d; nearest = p; }
      });
      if (nearest) RTS.Unit.orderAttack(u, { kind: 'unit', ref: nearest });
    }
  }

  function retreatTo(ai, point, spreadMul, force) {
    const units = recallUnits(mine(ai), force, squadTypeOf(ai), true);
    if (units.length === 0) return;
    for (const u of units) RTS.Unit.clearMicro(u);
    RTS.Formations.formationAttackMove(units, point.x, point.y, {
      useAttackMove: false, arriveDelay: false,
    });
  }

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
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, targets, 3, 'capture');
  }

  function captureExpand(ai) {
    const nodes = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const oppBase = theirs(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, oppBase.x, oppBase.y) - RTS.Unit.distTo(b, oppBase.x, oppBase.y));
    const targets = nodes.slice(0, 2);
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, targets, 3, 'capture');
  }

  function assignSquads(units, targets, perSquad, kind) {
    const assigned = new Map();
    const k = kind || 'capture';
    units.forEach((u) => {
      if (u.state !== 'idle' && u.state !== 'move' && u.state !== 'attackMove') return;
      for (const target of targets) {
        const n = assigned.get(target) || 0;
        if (n >= perSquad) continue;
        if (Math.hypot(u.x - target.x, u.y - target.y) < target.radius * 0.7) continue;
        const off = rallySlots(perSquad)[n];
        const sx = target.x + off.x * 0.5;
        const sy = target.y + off.y * 0.5;
        if (u.orderTarget && Math.hypot(u.orderTarget.x - sx, u.orderTarget.y - sy) < target.radius * 0.5) continue;
        RTS.Unit.orderAttackMove(u, sx, sy);
        u.microOrder = {
          kind: k, x: target.x, y: target.y,
          radius: k === 'raid' ? target.radius * 0.7 : target.radius * 0.8,
          nodeId: target.id, waypoints: null, wpIndex: 0, targetId: null,
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
    const mid = { x: (theirs(ai).base.x + mine(ai).base.x) / 2, y: laneY('mid') };
    assignAttackMove(units.slice(0, 8), [mid]);
  }

  function focusFire(ai, target) {
    const controlled = mine(ai);
    let best = null;
    if (target === 'base') {
      const oppBases = basesOf(theirs(ai));
      let bestScore = -Infinity;
      let bestDist = Infinity;
      for (const b of oppBases) {
        if (b.hp <= 0 || b.destroyed) continue;
        const score = 1 - b.hp / b.maxHp;
        const d = RTS.Unit.distTo(b, controlled.base.x, controlled.base.y);
        if (score > bestScore + 0.001 || (Math.abs(score - bestScore) <= 0.001 && d < bestDist)) {
          bestScore = score; bestDist = d; best = { kind: 'base', ref: b };
        }
      }
      if (!best) best = { kind: 'base', ref: oppBases[0] };
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
    const focusR = C().focusFireRadius;
    const allUnits = recallUnits(controlled, false, squadTypeOf(ai), true);
    for (const u of allUnits) RTS.Unit.clearMicro(u);

    const closeUnits = [];
    const farUnits = [];
    for (const u of allUnits) {
      const d = RTS.Unit.distTo(u, best.ref.x, best.ref.y);
      if (d <= focusR) closeUnits.push(u);
      else farUnits.push(u);
    }

    for (const u of closeUnits) RTS.Unit.orderAttack(u, best);
    if (farUnits.length > 0) {
      RTS.Formations.formationAttackMove(farUnits, best.ref.x, best.ref.y, { arriveDelay: true });
    }
  }

  function fallback(ai) {
    const base = mine(ai).base;
    const staging = { x: base.x + (theirs(ai).base.x - base.x) * 0.4, y: base.y };
    const units = recallUnits(mine(ai), false, squadTypeOf(ai));
    if (units.length === 0) return;
    RTS.Formations.formationAttackMove(units, staging.x, staging.y, { arriveDelay: true });
  }

  function raidEcon(ai) {
    const nodes = nodesOf(theirs(ai).owner);
    if (nodes.length === 0) return;
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai))).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 4, 'raid');
  }

  function defendChoke(ai) {
    const base = mine(ai).base;
    const dirX = theirs(ai).base.x > base.x ? 1 : -1;
    const chokepoints = laneIds().map((l) => ({ x: base.x + dirX * 220, y: laneY(l) }));
    const units = recallUnits(mine(ai), false, squadTypeOf(ai));
    if (units.length === 0) return;
    assignAttackMove(units, chokepoints);
  }

  // v10 新态势执行器
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

  function priorityDefense(ai) {
    defendChoke(ai);
    garrisonNodes(ai);
  }

  function sneak(ai) {
    const units = fastFirst(freeUnits(mine(ai), squadTypeOf(ai)));
    if (units.length === 0) return;
    const lane = ai.strategy.lane && LANE_LIST.includes(ai.strategy.lane) ? ai.strategy.lane : 'top';
    const target = laneTarget(ai, lane);
    assignAttackMove(units.slice(0, Math.min(8, units.length)), [target]);
  }

  function holdLine(ai) {
    const base = mine(ai).base;
    const opp = theirs(ai).base;
    const lane = ai.strategy.lane && LANE_LIST.includes(ai.strategy.lane) ? ai.strategy.lane : 'mid';
    const fx = base.x + (opp.x - base.x) * 0.62;
    const fy = laneY(lane);
    const units = recallUnits(mine(ai), false, squadTypeOf(ai), true);
    if (units.length === 0) return;
    for (const u of units) RTS.Unit.clearMicro(u);
    RTS.Formations.formationAttackMove(units, fx, fy, { arriveDelay: true });
  }

  // ------------------------------------------------------------------ 微指令

  function assignMicro(ai, unit, kind, x, y, opts) {
    opts = opts || {};
    unit.microOrder = {
      kind, x, y,
      radius: opts.radius != null ? opts.radius : C().aiMicroHoldRadius,
      nodeId: opts.nodeId || null,
      waypoints: opts.waypoints || null, wpIndex: 0,
      targetId: opts.targetId || null,
      until: RTS.state.time + (opts.duration != null ? opts.duration : C().aiMicroOrderLifetime),
      source: opts.source || 'staff',
    };
    if (kind === 'retreat' || kind === 'flee') RTS.Unit.orderMove(unit, x, y);
    else if (kind === 'patrol') {
      const wp = (unit.microOrder.waypoints && unit.microOrder.waypoints[0]) || { x, y };
      RTS.Unit.orderAttackMove(unit, wp.x, wp.y);
    } else RTS.Unit.orderAttackMove(unit, x, y);
  }

  function sameMicro(u, kind, x, y, tol) {
    const m = u.microOrder;
    if (!m || m.kind !== kind) return false;
    tol = tol || 60;
    return Math.hypot(m.x - x, m.y - y) < tol;
  }

  function nextCaptureTarget(ai, unit, prefType) {
    const cands = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (cands.length === 0) return null;
    const same = prefType ? cands.filter((n) => n.type === prefType) : [];
    const list = (same.length > 0 ? same : cands);
    list.sort((a, b) => RTS.Unit.distTo(a, unit.x, unit.y) - RTS.Unit.distTo(b, unit.x, unit.y));
    return list[0];
  }

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
        const fullyCaptured = n && n.owner === ai.owner && Math.abs(n.control) >= 0.99;
        const safe = n && intrudersNear(ai, n.x, n.y, n.radius * 1.3).length === 0;
        if (fullyCaptured && safe) {
          if (m.settledAt == null) m.settledAt = time;
          if (time - m.settledAt >= C().aiScoutCaptureSettleTime) {
            const next = nextCaptureTarget(ai, u, n.type);
            if (next) {
              m.nodeId = next.id; m.x = next.x; m.y = next.y;
              m.radius = next.radius * 0.8;
              m.until = time + C().aiMicroOrderLifetime;
              m.settledAt = null;
              RTS.Unit.orderAttackMove(u, next.x, next.y);
            } else {
              RTS.Unit.clearMicro(u);
            }
          }
        } else {
          m.settledAt = null;
        }
      } else if (m.kind === 'raid' && m.nodeId) {
        const n = nodesOf(null).find((x) => x.id === m.nodeId);
        if (n && n.owner === ai.owner) RTS.Unit.clearMicro(u);
      }
    });
  }

  // ------------------------------------------------------------------ v15：主将请求

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
      const myBases = basesOf(controlled);
      const enBases = basesOf(opponent);
      return Object.assign({}, base, {
        myGold: Math.round(controlled.gold),
        myWood: Math.round(controlled.wood),
        myStone: Math.round(controlled.stone),
        myPop: controlled.units.size,
        enemyPop: opponent.units.size,
        myArmy: armyCountsObj(myArmy),
        enemyArmy: armyCountsObj(opponentArmy),
        baseHp: Math.round(Math.min(...myBases.map((b) => b.hp))),
        enemyBaseHp: Math.round(Math.min(...enBases.map((b) => b.hp))),
        myBaseCount: myBases.length,
        enemyBaseCount: enBases.length,
        myBasesDestroyed: myBases.filter((b) => b.destroyed || b.hp <= 0).length,
        enemyBasesDestroyed: enBases.filter((b) => b.destroyed || b.hp <= 0).length,
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
        // v15：军团信息
        corpsCount: ai.corps.length,
        corpsSizes: ai.corps.map((c) => c.unitIds.size),
      });
    }
    return base;
  }

  function roleField(ai, role, suffix) {
    if (role === 'general') return ai['deepseek' + suffix];
    return null;
  }

  function maybeRequestRole(ai, role, time) {
    if (RTS.state.phase !== 'running') return;
    
    // v15：军团长请求
    if (role === 'corps_commander') {
      if (!ai.deepseekEverActive) return; // 主将成功接管后才启动军团长
      for (const corps of ai.corps) {
        if (!corps.commander.busy && time >= corps.commander.nextAt && corps.unitIds.size > 0) {
          corps.commander.busy = true;
          requestCorpsCommander(ai, corps, time);
        }
      }
      return;
    }
    
    if (roleField(ai, role, 'Busy') || time < roleField(ai, role, 'NextAt')) return;
    ai.deepseekBusy = true;
    requestRole(ai, role, time);
  }

  function requestRole(ai, role, time) {
    const payload = buildRolePayload(ai, role, time);
    const doFetch = typeof fetch === 'function' ? fetch : null;
    if (!doFetch) {
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

  function scheduleNextRole(ai, role, time) {
    ai.deepseekBusy = false;
    const Cfg = C();
    let min = Cfg.aiDecisionIntervalMin;
    let max = Cfg.aiDecisionIntervalMax;
    ai.deepseekNextAt = time + min + Math.random() * (max - min);
    ai.deepseekCount++;
  }

  function markRoleError(ai, role, reason) {
    if (role === 'general') {
      ai.deepseekActive = false;
      ai.lastDeepseekError = reason;
      ai.lastDecision = null;
    }
  }

  function applyRoleDecision(ai, role, decision, time) {
    if (role === 'general') { applyGeneral(ai, decision, time); return; }
  }

  function decisionSummary(ai, decision) {
    const parts = [];
    if (decision.stance) parts.push('态势：' + ((PHASE_LABEL[decision.stance]) || decision.stance));
    if (decision.armyFocus && RTS.Units.get(decision.armyFocus)) parts.push('主造：' + RTS.Units.get(decision.armyFocus).name);
    if (decision.lane) parts.push(decision.lane === 'mid' ? '中路' : decision.lane === 'top' ? '上路' : '下路');
    if (decision.corpsDirectives && decision.corpsDirectives.length > 0) {
      parts.push('军团指令×' + decision.corpsDirectives.length);
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

    // v15：保存军团长指令
    if (Array.isArray(decision.corpsDirectives)) {
      ai.strategy.corpsDirectives = decision.corpsDirectives;
    }

    // v9：分队指令——兼容保留
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
    const text = decision.comment || decisionSummary(ai, decision);
    if (text && RTS.UI && RTS.UI.aiMessage) {
      RTS.UI.aiMessage(ai.owner, '【主将】' + text);
    }
  }

  // ------------------------------------------------------------------ 降级自动驾驶

  function degradedPilot(ai, time) {
    const Cfg = C();
    const controlled = mine(ai);
    const myArmy = countArmy(controlled);

    if (intruderCount(ai) >= Cfg.aiDefenseIntruders) setPhase(ai, PHASE.defend, time);
    else if (myArmy.total >= Cfg.aiArmyThreshold) setPhase(ai, PHASE.all_in, time);
    else if (myArmy.total >= 8 && controlled.wood >= 180 && controlled.stone >= 180) setPhase(ai, PHASE.fortify, time);
    else if (myArmy.total >= 4) setPhase(ai, PHASE.rally, time);
    else setPhase(ai, PHASE.build, time);
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

  // ------------------------------------------------------------------ 每帧更新

  function updateAI(ai, dt) {
    const st = RTS.state;
    if (!st) return;
    const time = st.time;
    const controlled = mine(ai);
    const Cfg = C();

    // 1) v15：指挥链请求（主将 → 军团长）
    maybeRequestRole(ai, 'general', time);
    maybeRequestRole(ai, 'corps_commander', time);

    // 大模型尚未成功接管前，用极简降级自动驾驶保底
    if (!ai.deepseekEverActive) {
      ai.defenseTimer -= dt;
      if (ai.defenseTimer <= 0) {
        ai.defenseTimer = 0.5;
        degradedPilot(ai, time);
      }
    }

    // 2) v15：军团重组检查
    maybeReassignCorps(ai, time);

    // 2.1) v15：队长定期执行（每10秒重新执行军团长的命令，适应单位位置变化）
    const squadInterval = Cfg.aiSquadLeaderInterval || 10;
    for (const corps of ai.corps) {
      if (corps.commander.currentOrders.length > 0 &&
          corps.commander.nextSquadExecute &&
          time >= corps.commander.nextSquadExecute) {
        executeCorpsOrders(ai, corps, time);
        corps.commander.nextSquadExecute = time + squadInterval;
      }
    }

    // 3) 生产
    ai.productionTimer -= dt;
    if (ai.productionTimer <= 0) {
      ai.productionTimer = ai.productionInterval;
      const boost = ai.phase === PHASE.boom || ai.phase === PHASE.all_in || ai.phase === PHASE.siege;
      produce(ai, boost);
    }

    // 3.1) 科技升级
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

    // v10.2：基地生产队列拥堵计时
    if (controlled.productionQueue.length >= Cfg.baseQueueBarracksThreshold) {
      ai.queueCongestionTime += dt;
    } else {
      ai.queueCongestionTime = Math.max(0, ai.queueCongestionTime - dt);
    }

    // 4) 微指令过期清理
    expireMicroOrders(ai, time);

    // 4.1) 基建节奏
    if (ai.fortifyTimer <= 0) {
      ai.fortifyTimer = Cfg.aiFortifyRhythm;
      maybeProduceArchitect(ai);
      if (hasIdleArchitect(ai)) {
        if (repairBases(ai)) { /* 有被摧毁基地：建筑师已派去修复 */ }
        else if (needBarracks(ai) && armyAdvantage(ai) < Cfg.aiTowerFrontArmyLead) buildBarracks(ai);
        else fortify(ai);
      }
    }

    // 5) 按态势执行兜底低层指令（只指挥无微指令的单位）
    executePhase(ai, controlled, time);

    // v9：分队（编队）指令——与大态势并行（兼容保留）
    if (ai.strategy.squad && (ai.phaseChanged || ai.squadTimer <= 0)) {
      executeSquad(ai);
      ai.squadTimer = 3;
    }

    ai.phaseChanged = false;

    // 6) 总攻波计时衰减
    if (ai.phase === PHASE.assault_mid || ai.phase === PHASE.assault_top ||
        ai.phase === PHASE.assault_bottom || ai.phase === PHASE.all_in ||
        ai.phase === PHASE.pincer || ai.phase === PHASE.siege ||
        ai.phase === PHASE.sneak) {
      ai.waveElapsed += dt;
    }
  }

  /** 每帧驱动全部 AI 实例 */
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
      case PHASE.build: case PHASE.boom: break;
      case PHASE.tech:
        if (throttle()) { aiUpgrade(ai); ai.commandTimer = 2; } break;
      case PHASE.eco_defend:
        if (throttle()) { retreatTo(ai, mineF.base, 0.7); ai.commandTimer = 2; } break;
      case PHASE.fortify:
        if (throttle()) { fortify(ai); ai.commandTimer = 3; } break;
      case PHASE.scout:
        if (ai.phaseChanged || ai.scoutTimer <= 0) { scout(ai); ai.scoutTimer = 6; } break;
      case PHASE.scout_hold:
        if (throttle()) { scoutHold(ai); ai.commandTimer = 3; } break;
      case PHASE.counter_scout:
        if (throttle()) { defend(ai); ai.commandTimer = 1.5; } break;
      case PHASE.capture_gold:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'gold'); ai.nodeTimer = 4; } break;
      case PHASE.capture_wood:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'wood'); ai.nodeTimer = 4; } break;
      case PHASE.capture_stone:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureType(ai, 'stone'); ai.nodeTimer = 4; } break;
      case PHASE.capture_expand:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { captureExpand(ai); ai.nodeTimer = 4; } break;
      case PHASE.node_garrison:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { garrisonNodes(ai); ai.nodeTimer = 4; } break;
      case PHASE.rally:
        if (ai.phaseChanged || ai.rallyTimer <= 0) rally(ai); break;
      case PHASE.rally_hold:
        if (ai.phaseChanged) rally(ai); break;
      case PHASE.reinforce:
        if (throttle()) { rally(ai); ai.commandTimer = 2.5; } break;
      case PHASE.harass:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          attackLanes(ai, false, ['mid'], false);
          const aggr = ai.strategy.aggression / 100;
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMax - aggr * (Cfg.aiAttackCooldownMax - Cfg.aiAttackCooldownMin);
        } break;
      case PHASE.harass_flank:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          const lane = Math.random() < 0.5 ? 'top' : 'bottom';
          attackLanes(ai, false, [lane], false);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        } break;
      case PHASE.harass_econ:
        if (ai.phaseChanged || ai.nodeTimer <= 0) { raidEcon(ai); ai.nodeTimer = 5; } break;
      case PHASE.assault_mid:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['mid'], true); break;
      case PHASE.assault_top:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top'], true); break;
      case PHASE.assault_bottom:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['bottom'], true); break;
      case PHASE.all_in:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'mid', 'bottom'], true); break;
      case PHASE.pincer:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) attackLanes(ai, true, ['top', 'bottom'], true); break;
      case PHASE.feint:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) {
          attackLanes(ai, false, [ai.feintLane], false);
          ai.feintLane = ai.feintLane === 'top' ? 'bottom' : 'top';
        } break;
      case PHASE.siege:
        if (ai.phaseChanged || ai.commandTimer <= 0) { focusFire(ai, 'base'); ai.commandTimer = 2; } break;
      case PHASE.defend:
        if (throttle()) { defend(ai); ai.commandTimer = 1.5; } break;
      case PHASE.defend_choke:
        if (throttle()) { defendChoke(ai); ai.commandTimer = 2; } break;
      case PHASE.defend_node:
        if (throttle()) { garrisonNodes(ai); ai.commandTimer = 2; } break;
      case PHASE.counter_attack:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          defend(ai); attackLanes(ai, false, ['mid'], true);
          ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        } break;
      case PHASE.fallback:
        if (throttle()) { fallback(ai); ai.commandTimer = 2; } break;
      case PHASE.retreat:
        if (throttle()) { retreatTo(ai, mineF.base, 0.6, true); ai.commandTimer = 1.5; } break;
      case PHASE.regroup:
        if (ai.phaseChanged || ai.commandTimer <= 0) {
          retreatTo(ai, ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai), 0.8, true);
          ai.commandTimer = 2;
        } break;
      case PHASE.turtle:
        if (throttle()) { retreatTo(ai, mineF.base, 0.9, true); ai.commandTimer = 1.5; } break;
      case PHASE.ambush:
        if (ai.phaseChanged) ambush(ai); break;
      case PHASE.guerrilla:
        if (ai.phaseChanged || time >= ai.nextAttackTime) {
          guerrilla(ai); ai.nextAttackTime = time + Cfg.aiAttackCooldownMin;
        } break;
      case PHASE.priority_defense:
        if (throttle()) { priorityDefense(ai); ai.commandTimer = 2.5; } break;
      case PHASE.sneak:
        if (ai.phaseChanged || ai.waveElapsed >= ai.waveDuration) sneak(ai); break;
      case PHASE.hold_line:
        if (ai.phaseChanged || ai.commandTimer <= 0) { holdLine(ai); ai.commandTimer = 3; } break;
    }
  }

  // v9：分队（编队）指令执行器（兼容保留）
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

  function squadRetreat(ai, type, point, spreadMul) {
    const units = unitsOfType(mine(ai), type, true);
    if (units.length === 0) return;
    const slots = rallySlots(units.length);
    units.forEach((u, i) => {
      const slot = slots[i % slots.length];
      RTS.Unit.orderMove(u, point.x + slot.x * (spreadMul || 0.6), point.y + slot.y * (spreadMul || 0.6));
    });
  }

  function squadCapture(ai, type) {
    const nodes = nodesOf(null).filter((n) => n.owner !== ai.owner);
    if (nodes.length === 0) return;
    const base = mine(ai).base;
    nodes.sort((a, b) => RTS.Unit.distTo(a, base.x, base.y) - RTS.Unit.distTo(b, base.x, base.y));
    const units = unitsOfType(mine(ai), type, false).filter((u) => u.type !== 'architect');
    if (units.length === 0) return;
    assignSquads(units, nodes.slice(0, 2), 3, 'capture');
  }

  function executeSquad(ai) {
    const sq = ai.strategy && ai.strategy.squad;
    if (!sq || !RTS.Units.has(sq.type)) return;
    const type = sq.type;
    const lane = sq.lane && LANE_LIST.includes(sq.lane) ? sq.lane : 'mid';
    switch (sq.task) {
      case 'attack': squadAttackLanes(ai, type, [lane], true); break;
      case 'defend': squadRetreat(ai, type, mine(ai).base, 0.7); break;
      case 'capture': squadCapture(ai, type); break;
      case 'rally': squadRetreat(ai, type, ai.rallyPoint && ai.rallyPoint.x ? ai.rallyPoint : rallyPointOf(ai), 0.8); break;
      case 'retreat': squadRetreat(ai, type, mine(ai).base, 0.6); break;
      case 'harass': default: squadAttackLanes(ai, type, [lane], false); break;
    }
  }

  // 筑垒
  function fortify(ai) {
    if (!RTS.Units.has('architect') || !RTS.Towers) return;
    const controlled = mine(ai);
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') architects.push(u);
    });
    if (architects.length === 0) return;
    const spots = resolveTowerSpots(ai);
    if (spots.length === 0) return;
    let placed = 0;
    for (const u of architects) {
      const spot = spots[placed % spots.length];
      if (u.orderTarget && Math.hypot(u.orderTarget.x - spot.x, u.orderTarget.y - spot.y) < 60) continue;
      RTS.Unit.clearMicro(u);
      const res = RTS.Towers.orderBuild(u, spot.x, spot.y);
      if (res.ok) placed++;
      else if (res.reason === 'cap' || res.reason === 'wood' || res.reason === 'stone') break;
    }
  }

  function repairBases(ai) {
    if (!RTS.Units.has('architect') || !RTS.Bases) return false;
    const controlled = mine(ai);
    const destroyed = RTS.Bases.destroyedBases(ai.owner);
    if (destroyed.length === 0) return false;
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return;
      if (u.state === 'idle' || u.state === 'move' || u.state === 'attackMove') architects.push(u);
    });
    if (architects.length === 0) return false;
    destroyed.sort((a, b) => RTS.Unit.distTo(a, controlled.base.x, controlled.base.y) - RTS.Unit.distTo(b, controlled.base.x, controlled.base.y));
    let placed = 0;
    for (const u of architects) {
      const base = destroyed[placed % destroyed.length];
      if (u.orderTarget && Math.hypot(u.orderTarget.x - base.x, u.orderTarget.y - base.y) < 80) continue;
      RTS.Unit.clearMicro(u);
      const res = RTS.Bases.orderRepair(u, base);
      if (res.ok) placed++;
      else if (res.reason === 'wood' || res.reason === 'stone') break;
    }
    return placed > 0;
  }

  function architectNeeded(ai) {
    const controlled = mine(ai);
    const Cfg = C();
    const archCount = countType(controlled, 'architect');
    const destroyed = RTS.Bases ? RTS.Bases.destroyedBases(ai.owner) : [];
    if (destroyed.length > 0) {
      if (archCount >= 1) return false;
      if (controlled.wood < Cfg.baseRepairCost.wood || controlled.stone < Cfg.baseRepairCost.stone) return false;
      if (RTS.state.time < Cfg.aiArchitectMinTime) return false;
      return true;
    }
    const towers = RTS.Towers ? RTS.Towers.towerCount(ai.owner) : 0;
    const barracks = RTS.Barracks ? RTS.Barracks.barracksCount(ai.owner) : 0;
    if (archCount >= Cfg.aiArchitectTarget) return false;
    if (towers >= Cfg.maxTowersPerFaction && barracks >= Cfg.aiBarracksTarget) return false;
    if (controlled.wood < Cfg.towerBuildCost.wood || controlled.stone < Cfg.towerBuildCost.stone) return false;
    if (RTS.state.time < Cfg.aiArchitectMinTime) return false;
    return true;
  }

  function hasIdleArchitect(ai) {
    const controlled = mine(ai);
    let found = false;
    controlled.units.forEach((u) => {
      if (u.type === 'architect' && u.hp > 0 && !u.building && u.state !== 'attack') found = true;
    });
    return found;
  }

  function maybeProduceArchitect(ai) {
    if (!RTS.Units.has('architect') || !architectNeeded(ai)) return;
    const controlled = mine(ai);
    if (controlled.productionQueue.some((q) => q.type === 'architect')) return;
    const check = RTS.Production.canOrder(controlled, 'architect');
    if (check.ok) RTS.Production.order(controlled, 'architect');
  }

  // 兵营
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

  function needBarracks(ai) {
    if (!RTS.Units.has('architect') || !RTS.Barracks) return false;
    const Cfg = C();
    const controlled = mine(ai);
    if (RTS.Barracks.barracksCount(ai.owner) >= Cfg.aiBarracksTarget) return false;
    const econStrong = controlled.goldRate >= Cfg.aiBarracksMinGoldRate || controlled.gold >= Cfg.aiBarracksMinGold;
    if (!econStrong) return false;
    const strained = ai.queueCongestionTime >= Cfg.aiBarracksCongestionTime ||
      controlled.gold >= Cfg.goldCap * 0.75 ||
      controlled.units.size >= Cfg.populationCap * 0.85;
    if (!strained) return false;
    if (controlled.wood < Cfg.barracksBuildCost.wood || controlled.stone < Cfg.barracksBuildCost.stone) return false;
    return true;
  }

  function buildBarracks(ai) {
    if (!RTS.Units.has('architect') || !RTS.Barracks) return;
    const controlled = mine(ai);
    const architects = [];
    controlled.units.forEach((u) => {
      if (u.type !== 'architect' || u.hp <= 0) return;
      if (u.building) return;
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
      else if (res.reason === 'cap' || res.reason === 'wood' || res.reason === 'stone') break;
    }
  }

  function buildTowerCandidates(ai) {
    const me = mine(ai);
    const opp = theirs(ai);
    const dirX = opp.base.x > me.base.x ? 1 : -1;
    const cands = [];
    laneIds().forEach((l) => {
      cands.push({ spot: 'choke_' + l, desc: '桥头(' + l + ')', x: me.base.x + dirX * 260, y: laneY(l) });
    });
    if (armyAdvantage(ai) >= C().aiTowerFrontArmyLead) {
      laneIds().forEach((l) => {
        cands.push({ spot: 'front_' + l, desc: '前线桥头(' + l + ')', x: opp.base.x - dirX * 260, y: laneY(l) });
      });
    }
    nodesOf(ai.owner).slice(0, 6).forEach((n) => {
      cands.push({ spot: 'node_' + n.id, desc: '资源点(' + n.type + ' #' + n.id + ')', x: n.x + dirX * 70, y: n.y });
    });
    basesOf(me).forEach((b, i) => {
      cands.push({ spot: 'base' + (i + 1) + '_l', desc: '基地' + (i + 1) + '上方侧翼', x: b.x + dirX * 200, y: b.y - 90 });
      cands.push({ spot: 'base' + (i + 1) + '_r', desc: '基地' + (i + 1) + '下方侧翼', x: b.x + dirX * 200, y: b.y + 90 });
    });
    return cands.map((c) => ({ spot: c.spot, desc: c.desc, x: Math.round(c.x), y: Math.round(c.y) }));
  }

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
      const me = mine(ai);
      const opp = theirs(ai);
      const dirX = opp.base.x > me.base.x ? 1 : -1;
      const front = armyAdvantage(ai) >= C().aiTowerFrontArmyLead;
      laneIds().forEach((l) => {
        out.push(front
          ? { x: opp.base.x - dirX * 260, y: laneY(l) }
          : { x: me.base.x + dirX * 260, y: laneY(l) });
      });
      nodesOf(ai.owner).slice(0, 2).forEach((n) => out.push({ x: n.x + dirX * 70, y: n.y }));
      basesOf(me).forEach((b) => {
        out.push({ x: b.x + dirX * 200, y: b.y - 90 });
        out.push({ x: b.x + dirX * 200, y: b.y + 90 });
      });
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
    ROLE_LABEL,
    CORPS_ACTIONS,
    laneTarget,
    aliveBasesOf,
  };
})();
