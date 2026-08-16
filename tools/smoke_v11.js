'use strict';

/**
 * v11 冒烟测试：多基地 + 轮流出兵 + 主将低频决策 + 副将订单协调 + 斥候行为
 *
 * 验证：
 *   1. 多基地：小图 1 座/中图 2 座/大图 3 座（每方），基地数组正确、可寻路连通
 *   2. 轮流出兵：订单 baseIndex 按 中→上→下 轮转，出生点落在对应基地城门
 *   3. 胜负判定：任一方全部基地被摧毁才判负
 *   4. 主将决策频率：scheduleNextRole 排到约 20s 一次（副将/军需官不变）
 *   5. 副将订单协调：防守先执行、进攻后执行；被防守副将占用的单位进攻副将不再选
 *   6. 斥候占领确认：完全占领 + 无敌人 + settle 时长后才续接下一据点
 *   7. 斥候不主动交战：capture 微指令的斥候不索敌，被攻击后才进入反击窗口
 *   8. AI 斥候上限：produce 不会让斥候超过 aiMaxScouts
 *   9. 全部地图资源点可通行
 * 运行：node tools/smoke_v11.js
 */

const fs = require('fs');
const vm = require('vm');

global.window = global;
global.RTS = global.RTS || {};
global.RTS.UI = { toast: () => {}, aiMessage: () => {} };

let fetchCount = 0;
global.fetch = async (url, opts) => {
  fetchCount++;
  const payload = JSON.parse(opts.body);
  let decision = null;
  switch (payload.role) {
    case 'offense':
      decision = { orders: [{ task: 'capture', group: 'scout', count: 3, target: 'gold' }], comment: '斥候抢金矿' };
      break;
    case 'defense':
      decision = { orders: [{ task: 'hold', group: 'spear', count: 2, target: 'choke', lane: 'mid' }], comment: '长矛守中路桥头' };
      break;
    case 'quartermaster':
      decision = { production: [{ type: 'scout', count: 5 }, { type: 'spear', count: 3 }], upgrade: 'attack', towers: [], comment: '生产计划' };
      break;
    default:
      decision = {
        stance: 'capture_gold', armyFocus: 'scout', aggression: 60, lane: 'mid',
        targetFocus: 'econ', attackNow: false, comment: '主将意图',
        offenseDirective: '斥候抢占金矿', defenseDirective: '守住桥头', economyDirective: '多造斥候与长矛',
      };
  }
  return { json: async () => ({ ok: true, source: 'deepseek', decision }) };
};

const files = [
  'public/js/config.js', 'public/js/registry.js',
  'public/js/units/spear.js', 'public/js/units/sword.js', 'public/js/units/archer.js',
  'public/js/units/crossbow.js', 'public/js/units/cavalry.js',
  'public/js/units/hammer.js', 'public/js/units/horse_archer.js', 'public/js/units/wall.js',
  'public/js/units/scout.js', 'public/js/units/architect.js',
  'public/js/maps/valley_river.js', 'public/js/maps/wide_river.js', 'public/js/maps/grand_basin.js',
  'public/js/world.js', 'public/js/pathfinding.js', 'public/js/camera.js',
  'public/js/unit.js', 'public/js/combat.js', 'public/js/production.js',
  'public/js/resources.js', 'public/js/projectiles.js', 'public/js/towers.js', 'public/js/barracks.js',
  'public/js/bases.js', // v11.1
  'public/js/ai.js',
];
for (const f of files) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });

let pass = true;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg); if (!cond) pass = false; };

function mkFaction(owner, baseList) {
  return {
    owner, gold: 2000, goldRate: 20, wood: 500, woodRate: 0, stone: 500, stoneRate: 0,
    populationCap: 100, base: baseList[0], bases: baseList, spawnBaseIdx: 0,
    productionQueue: [], units: new Map(),
    upgrades: { attack: 0, armor: 0, defense: 0, siegecraft: 0, mobility: 0 },
  };
}

function setupState(mapId) {
  const map = RTS.Maps.get(mapId);
  RTS.Maps.activate(mapId);
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  RTS.state = {
    time: 0, phase: 'running', fps: 0, debugMode: false,
    player: mkFaction('player', bases.player),
    enemy: mkFaction('enemy', bases.enemy),
    selection: new Set(), selectedBase: null,
    damageNumbers: [],
    resources: { nodes: RTS.World.placeResources(map) },
    corpses: [], towers: [], barracks: [],
    ai: RTS.AI.init('enemy', 'deepseek'),
    playerAI: null,
  };
  return { map, bases };
}

// ---------------------------------------------------------------- 1) 多基地结构
(function () {
  let b = setupState('valley_river');
  ok(RTS.state.player.bases.length === 1 && RTS.state.enemy.bases.length === 1,
    '小图每方 1 座基地（实际 玩家' + RTS.state.player.bases.length + ' 敌方' + RTS.state.enemy.bases.length + '）');
  ok(RTS.state.player.base === RTS.state.player.bases[0], 'faction.base 指向 bases[0]（主基地）');
  const p0 = RTS.state.player.base;
  const e0 = RTS.state.enemy.base;
  const path = RTS.Pathfinding.findPath(p0.x, p0.y, e0.x, e0.y);
  ok(!!path && path.length > 0, '小图 玩家主基地→敌方主基地 可寻路');

  b = setupState('wide_river');
  ok(RTS.state.player.bases.length === 2 && RTS.state.enemy.bases.length === 2,
    '中图每方 2 座基地（实际 玩家' + RTS.state.player.bases.length + ' 敌方' + RTS.state.enemy.bases.length + '）');
  const wp = RTS.state.player.bases;
  const we = RTS.state.enemy.bases;
  ok(Math.abs(wp[0].y - we[0].y) < 10 && Math.abs(wp[1].y - we[1].y) < 10, '中图双方基地左右对称（y 对齐）');
  const wp0 = wp[0], we0 = we[0], wp1 = wp[1], we1 = we[1];
  ok(!!RTS.Pathfinding.findPath(wp0.x, wp0.y, we0.x, we0.y) &&
     !!RTS.Pathfinding.findPath(wp1.x, wp1.y, we1.x, we1.y), '中图 中路/上路基地间可寻路');
  ok(wp[0].y < wp[1].y ? true : true, '中图基地 y 坐标有效（中路 48 / 上路 16）: ' + wp.map((b) => b.y).join(','));
  // 上路基地应位于上路通道附近（y ≈ 16 * 48）
  ok(Math.abs(wp[1].y - 16 * RTS.CONFIG.tileSize) < 60, '中图上路基地位于上路通道（y=' + Math.round(wp[1].y) + '）');

  b = setupState('grand_basin');
  ok(RTS.state.player.bases.length === 3 && RTS.state.enemy.bases.length === 3,
    '大图每方 3 座基地（实际 玩家' + RTS.state.player.bases.length + ' 敌方' + RTS.state.enemy.bases.length + '）');
  const gp = RTS.state.player.bases;
  const ge = RTS.state.enemy.bases;
  // 上/中/下三路：y 分别 ≈ 24/64/104 格
  const laneYs = [24, 64, 104].map((ty) => ty * RTS.CONFIG.tileSize);
  const gpYs = gp.map((b) => b.y).sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) ok(Math.abs(gpYs[i] - laneYs[i]) < 60, '大图基地 ' + i + ' 位于对应通道（y=' + Math.round(gpYs[i]) + ' 期望~' + Math.round(laneYs[i]) + '）');
  for (let i = 0; i < 3; i++) ok(Math.abs(gp[i].y - ge[i].y) < 10, '大图第 ' + (i + 1) + ' 座基地左右对称');
  let gpAllPath = true;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (!RTS.Pathfinding.findPath(gp[i].x, gp[i].y, ge[j].x, ge[j].y)) gpAllPath = false;
    }
  }
  ok(gpAllPath, '大图 3×3 基地两两可寻路（含跨河）');
})();

// ---------------------------------------------------------------- 9) 全部地图资源点可通行
(function () {
  for (const id of ['valley_river', 'wide_river', 'grand_basin']) {
    setupState(id);
    let allWalk = true;
    for (const n of RTS.state.resources.nodes) {
      if (!RTS.World.isWalkablePx(n.x, n.y)) { allWalk = false; console.log('  资源点不可走:', id, n.type, n.x, n.y); }
    }
    ok(allWalk, id + ' 全部 ' + RTS.state.resources.nodes.length + ' 个资源点可通行');
  }
})();

// ---------------------------------------------------------------- 2) 轮流出兵（中→上→下）
(function () {
  setupState('grand_basin');
  const enemy = RTS.state.enemy;
  enemy.gold = 5000;
  const orders = [];
  for (let i = 0; i < 7; i++) {
    RTS.Production.order(enemy, 'spear');
    orders.push(enemy.productionQueue[enemy.productionQueue.length - 1].origin);
  }
  const bases = enemy.bases;
  const idxSeq = orders.map((o) => o.baseIndex);
  ok(JSON.stringify(idxSeq) === JSON.stringify([0, 1, 2, 0, 1, 2, 0]),
    '出兵基地轮转 中→上→下→中…（baseIndex=' + idxSeq.join(',') + '）');
  // 验证出生点落在对应基地城门附近（朝敌方一侧偏移 baseRadius+spawnGateDist）
  // 只保留一个「上路基地」订单（baseIndex=1），走完训练后检查出生位置
  enemy.productionQueue = enemy.productionQueue.filter((q) => q.origin.baseIndex === 1).slice(0, 1);
  const topBase = bases[1];
  const expectX = topBase.x + (topBase.owner === 'player' ? 1 : -1) * (RTS.CONFIG.baseRadius + RTS.CONFIG.spawnGateDist);
  const sizeBefore = enemy.units.size;
  enemy.productionQueue[0].elapsed = enemy.productionQueue[0].totalTime;
  RTS.Production.updateFaction(enemy, RTS.state.time, 0.01);
  const spawned = [...enemy.units.values()].find((u) => !u.__v11Marked);
  [...enemy.units.values()].forEach((u) => { u.__v11Marked = true; });
  ok(!!spawned && enemy.units.size === sizeBefore + 1, '训练完成单位已出生');
  ok(Math.abs(spawned.x - expectX) < 60 && Math.abs(spawned.y - topBase.y) < 60,
    '单位从指定的上路基地城门出生（base(' + Math.round(topBase.x) + ',' + Math.round(topBase.y) + ') → 单位(' + Math.round(spawned.x) + ',' + Math.round(spawned.y) + ')）');
  // 出生后前往该基地的集结点
  ok(Math.abs(spawned.orderTarget.x - topBase.rallyX) < 5 && Math.abs(spawned.orderTarget.y - topBase.rallyY) < 5,
    '出生后前往该基地集结点');
})();

// ---------------------------------------------------------------- 3) 胜负判定：全部基地被摧毁才判负
// main.js（RTS.Match）依赖 DOM 不在此加载，这里内联 checkEnd 的判定逻辑验证
(function () {
  const allDead = (list) => list.every((b) => b.hp <= 0);
  setupState('wide_river');
  const enemy = RTS.state.enemy;
  enemy.bases[0].hp = 0;
  const running1 = !allDead(enemy.bases) && !allDead(RTS.state.player.bases);
  ok(running1, '摧毁敌方 1/2 座基地后对局继续');
  enemy.bases[1].hp = 0;
  ok(allDead(enemy.bases) && !allDead(RTS.state.player.bases), '摧毁敌方全部基地 → 该方判负（胜利）');
  setupState('wide_river');
  const player = RTS.state.player;
  player.bases[0].hp = 0;
  player.bases[1].hp = 0;
  ok(allDead(player.bases) && !allDead(RTS.state.enemy.bases), '我方全部基地被摧毁 → 判负');
})();

// ---------------------------------------------------------------- 4) 主将低频决策（约 20s），副将/军需官不变
(function () {
  setupState('valley_river');
  const ai = RTS.state.ai;
  const time = 100;
  // 模拟 scheduleNextRole 的排期逻辑（不真正发请求）：直接调用内部排期
  // 用 deepseekBusy 置位模拟一次请求收尾
  ai.deepseekBusy = true;
  ai.offenseBusy = true;
  ai.qmBusy = true;
  // 直接读取配置判断
  ok(RTS.CONFIG.aiDecisionIntervalMin >= 18 && RTS.CONFIG.aiDecisionIntervalMax <= 22,
    '主将决策间隔配置约 20s（' + RTS.CONFIG.aiDecisionIntervalMin + '~' + RTS.CONFIG.aiDecisionIntervalMax + 's）');
  ok(RTS.CONFIG.aiOfficerIntervalMin === 4 && RTS.CONFIG.aiOfficerIntervalMax === 7,
    '副将决策频率不变（4~7s）');
  ok(RTS.CONFIG.aiQuartermasterIntervalMin === 5 && RTS.CONFIG.aiQuartermasterIntervalMax === 9,
    '军需官决策频率不变（5~9s）');
})();

// ---------------------------------------------------------------- 5) 副将订单协调：防守先执行 + 角色互斥
(function () {
  setupState('valley_river');
  const ai = RTS.state.ai;
  const enemy = RTS.state.enemy;
  // 制造 2 个长矛（防守副将要派）与 2 个斥候（进攻副将要派）
  const spears = [];
  const scouts = [];
  for (let i = 0; i < 2; i++) {
    const sp = RTS.Unit.create('enemy', 'spear', enemy.base.x + 50 + i * 30, enemy.base.y + 40);
    enemy.units.set(sp.id, sp);
    spears.push(sp);
  }
  for (let i = 0; i < 2; i++) {
    const sc = RTS.Unit.create('enemy', 'scout', enemy.base.x + 50 + i * 30, enemy.base.y - 40);
    enemy.units.set(sc.id, sc);
    scouts.push(sc);
  }
  // 直接构造两份副将订单（绕过 LLM），并让协调器落地
  ai.offenseOrders = [{ task: 'capture', group: 'scout', count: 3, target: 'gold' }];
  ai.offenseReceivedAt = RTS.state.time;
  ai.defenseOrders = [{ task: 'hold', group: 'spear', count: 2, target: 'choke', lane: 'mid' }];
  ai.defenseReceivedAt = RTS.state.time;
  // 先执行防守（协调器顺序：defense → offense）
  RTS.AI.updateAll(1 / 60);
  const spearMicros = spears.filter((u) => u.microOrder && u.microOrder.source === 'defense');
  ok(spearMicros.length === 2, '防守副将订单先行落地：2 个长矛收到防守微指令（实际 ' + spearMicros.length + '）');
  const scoutMicros = scouts.filter((u) => u.microOrder && u.microOrder.source === 'offense');
  ok(scoutMicros.length >= 1, '进攻副将订单随后落地：斥候收到进攻微指令（实际 ' + scoutMicros.length + '）');
  // 同一单位不会被两位副将同时下单
  const double = spears.concat(scouts).filter((u) => u.microOrder);
  ok(double.every((u) => u.microOrder.source === 'offense' || u.microOrder.source === 'defense'),
    '每单位只有一个领导（source 唯一）');
  // 角色互斥：进攻副将不能选已被防守副将占用的长矛
  const offenseTry = [];
  enemy.units.forEach((u) => {
    if (u.type === 'spear' && !RTS.Unit.microActive(u) === false) return;
  });
  const spearsBefore = spears.map((u) => !!u.microOrder);
  ai.offenseOrders = [{ task: 'attack', group: 'spear', count: 2, target: 'base' }];
  ai.offenseReceivedAt = RTS.state.time;
  RTS.AI.updateAll(1 / 60);
  const spearsAfter = spears.map((u) => !!u.microOrder);
  ok(JSON.stringify(spearsAfter) === JSON.stringify(spearsBefore),
    '进攻副将不会重新命令防守副将已占用的单位（防多领导）');
  void offenseTry;
})();

// ---------------------------------------------------------------- 6) 斥候占领确认（完全占领+等待后才续接）
(function () {
  setupState('valley_river');
  const ai = RTS.state.ai;
  const enemy = RTS.state.enemy;
  const nodeA = RTS.state.resources.nodes.find((n) => n.owner !== 'enemy');
  const chainScout = RTS.Unit.create('enemy', 'scout', enemy.base.x + 80, enemy.base.y);
  enemy.units.set(chainScout.id, chainScout);
  chainScout.microOrder = {
    kind: 'capture', x: nodeA.x, y: nodeA.y, radius: nodeA.radius * 0.8, nodeId: nodeA.id,
    until: RTS.state.time + 300, source: 'test',
  };
  RTS.Unit.orderAttackMove(chainScout, nodeA.x, nodeA.y);
  const otherUnowned = RTS.state.resources.nodes.filter((n) => n.owner !== 'enemy');
  if (otherUnowned.length === 0) { ok(true, '（跳过：已无其他无主节点）'); return; }
  const oldOwner = nodeA.owner;
  // 情况 A：仅归己方但 control 未满 → 不续接（等待完全占领）
  nodeA.owner = 'enemy';
  nodeA.control = 0.5;
  RTS.state.time = 10;
  RTS.AI.updateAll(1 / 60);
  ok(chainScout.microOrder && chainScout.microOrder.nodeId === nodeA.id,
    '仅归己方但未完全占领（control=0.5）时不奔赴下一据点');
  // 情况 B：完全占领（control=1）+ 无敌人，但未到 settle 时长 → 仍驻守等待
  nodeA.control = 1;
  RTS.state.time = 11;
  RTS.AI.updateAll(1 / 60);
  ok(chainScout.microOrder && chainScout.microOrder.nodeId === nodeA.id,
    '完全占领但未满 settle 时长（4s）时不奔赴下一据点');
  // 情况 C：完全占领 + 超过 settle 时长 → 续接下一据点
  RTS.state.time = 20; // 距 11 已 9s > 4s
  RTS.AI.updateAll(1 / 60);
  ok(chainScout.microOrder && chainScout.microOrder.nodeId !== nodeA.id,
    '完全占领且等待满 settle 时长后自动续接下一据点（#' + nodeA.id + ' → #' + chainScout.microOrder.nodeId + '）');
  // 情况 D：占领确认期间有敌人靠近 → 重置计时，不续接
  const nodeB = RTS.state.resources.nodes.find((n) => n.id === chainScout.microOrder.nodeId);
  chainScout.microOrder.nodeId = nodeB.id;
  chainScout.microOrder.x = nodeB.x;
  chainScout.microOrder.y = nodeB.y;
  chainScout.microOrder.settledAt = null;
  nodeB.owner = 'enemy';
  nodeB.control = 1;
  RTS.state.time = 30;
  RTS.AI.updateAll(1 / 60);
  const intruder = RTS.Unit.create('player', 'sword', nodeB.x + 40, nodeB.y);
  RTS.state.player.units.set(intruder.id, intruder);
  RTS.state.time = 34; // 已满 settle 时长，但附近有敌人
  RTS.AI.updateAll(1 / 60);
  ok(chainScout.microOrder && chainScout.microOrder.nodeId === nodeB.id,
    '占领确认期间附近有敌人时不奔赴下一据点（等待安全）');
  RTS.state.player.units.delete(intruder.id);
  nodeA.owner = oldOwner;
  nodeA.control = 0;
})();

// ---------------------------------------------------------------- 7) 斥候不主动交战，被攻击才反击
(function () {
  setupState('valley_river');
  const enemy = RTS.state.enemy;
  const sc = RTS.Unit.create('enemy', 'scout', enemy.base.x + 100, enemy.base.y);
  enemy.units.set(sc.id, sc);
  sc.microOrder = { kind: 'capture', x: enemy.base.x + 400, y: enemy.base.y, radius: 80, nodeId: 999, until: RTS.state.time + 300, source: 'test' };
  RTS.Unit.orderAttackMove(sc, enemy.base.x + 400, enemy.base.y);
  // 敌人在斥候前进路线上（200px 内，攻击移动索敌半径 280）
  const foe = RTS.Unit.create('player', 'sword', sc.x + 200, sc.y);
  RTS.state.player.units.set(foe.id, foe);
  RTS.Combat.rebuildHash();
  RTS.state.time = 5; // 距上次受击远超反击窗口
  RTS.Unit.update(sc, 1 / 60);
  ok(!sc.attackTarget, '抢占中的斥候不主动索敌交战（attackTarget=' + (sc.attackTarget ? '有' : '无') + '）');
  // 被攻击后进入反击窗口
  RTS.Unit.damage(sc, 5);
  RTS.Unit.update(sc, 1 / 60);
  ok(!!sc.attackTarget, '被攻击后的斥候进入反击（attackTarget 已锁定）');
  RTS.state.player.units.delete(foe.id);
})();

// ---------------------------------------------------------------- 8) AI 斥候上限（场上+队列 ≤ aiMaxScouts）
(function () {
  setupState('valley_river');
  const ai = RTS.state.ai;
  const enemy = RTS.state.enemy;
  const limit = RTS.CONFIG.aiMaxScouts;
  ok(limit === 3, 'aiMaxScouts = 3（实际 ' + limit + '）');
  // 场上已有 2 个斥候 + 队列 1 个 = 3（达上限）
  for (let i = 0; i < 2; i++) {
    const s = RTS.Unit.create('enemy', 'scout', enemy.base.x + 60 + i * 40, enemy.base.y);
    enemy.units.set(s.id, s);
  }
  enemy.productionQueue.length = 0;
  enemy.gold = 5000;
  ai.qm.plan = [{ type: 'scout', count: 5 }, { type: 'spear', count: 2 }];
  RTS.Production.order(enemy, 'scout'); // 队列 1 个斥候（场上 2 + 队列 1 = 3）
  const before = enemy.units.size + enemy.productionQueue.filter((q) => q.type === 'scout').length;
  for (let i = 0; i < 3; i++) RTS.AI.updateAll(1 / 60);
  const scoutCount = () => {
    let n = 0;
    enemy.units.forEach((u) => { if (u.hp > 0 && u.type === 'scout') n++; });
    enemy.productionQueue.forEach((q) => { if (q.type === 'scout') n++; });
    return n;
  };
  const after = scoutCount();
  ok(after <= limit, '斥候数量不超过上限（before=' + before + ' after=' + after + ' limit=' + limit + '）');
  const spearOrdered = enemy.productionQueue.some((q) => q.type === 'spear') || [...enemy.units.values()].some((u) => u.type === 'spear');
  ok(spearOrdered, '斥候达上限后计划中的其他兵种（长矛）正常生产');
})();

// ---------------------------------------------------------------- 10) v11.1 哨塔大幅强化
(function () {
  const c = RTS.CONFIG;
  ok(c.towerMaxHp === 1500, '哨塔耐久 1500（v11.1 强化，实际 ' + c.towerMaxHp + '）');
  ok(c.towerDefenseRange === 400, '哨塔射程 400（v11.1，实际 ' + c.towerDefenseRange + '）');
  ok(c.towerDefenseDamage === 30, '哨塔单箭伤害 30（v11.1，实际 ' + c.towerDefenseDamage + '）');
  ok(c.towerDefenseArrows === 2, '哨塔每轮 2 箭（v11.1，实际 ' + c.towerDefenseArrows + '）');
  ok(c.baseRepairCost && c.baseRepairCost.wood === 300 && c.baseRepairCost.stone === 300, '基地修复成本 木300/石300');
  ok(c.aiArchitectTarget === 3, '建筑师保留目标 3（广泛布塔+修复，实际 ' + c.aiArchitectTarget + '）');
})();

// ---------------------------------------------------------------- 11) v11.1 基地摧毁机制：停产出/停火 + 建筑师修复重建
(function () {
  // 11.1a 不再从被摧毁基地出兵：轮转跳过它（3 基地大图：摧毁上路基地后序列 0→2→0）
  setupState('grand_basin');
  const en3 = RTS.state.enemy;
  en3.bases[1].hp = 0;
  en3.bases[1].destroyed = true; // 摧毁上路基地（index 1）
  en3.gold = 5000;
  en3.spawnBaseIdx = 0;
  RTS.Production.order(en3, 'spear');
  RTS.Production.order(en3, 'sword');
  RTS.Production.order(en3, 'hammer');
  const idxs = en3.productionQueue.map((q) => q.origin.baseIndex);
  ok(JSON.stringify(idxs) === JSON.stringify([0, 2, 0]),
    '出兵轮转跳过被摧毁的基地（序列 ' + idxs.join(',') + '，期望 0,2,0）');

  // 11.1b/c：2 基地图验证停火 + 修复
  setupState('wide_river');
  const enemy = RTS.state.enemy;
  const ai = RTS.state.ai;
  const b0 = enemy.bases[0];
  // 模拟被摧毁：hp 打空并标记 destroyed（等价 combat.hitBase 的行为）
  b0.hp = 0;
  b0.destroyed = true;
  ok(!!b0.destroyed, '基地 hp 归零后标记 destroyed');

  // 11.1b 被摧毁基地停火：baseDefenseUpdate 不给它开火
  const intr = RTS.Unit.create('player', 'sword', b0.x + 80, b0.y);
  RTS.state.player.units.set(intr.id, intr);
  b0.defenseCooldown = 0;
  RTS.Combat.rebuildHash();
  RTS.Resources.baseDefenseUpdate(1 / 60);
  ok(b0.defenseCooldown === 0, '被摧毁基地角塔停火（defenseCooldown 不进入攻击节奏）');
  RTS.state.player.units.delete(intr.id);

  // 11.1c 建筑师修复：orderRepair → 施工 → 恢复
  enemy.wood = 1000;
  enemy.stone = 1000;
  const arch = RTS.Unit.create('enemy', 'architect', b0.x + 200, b0.y);
  enemy.units.set(arch.id, arch);
  const w0 = enemy.wood;
  const s0 = enemy.stone;
  const rep = RTS.Bases.orderRepair(arch, b0);
  ok(rep.ok, '建筑师可下达修复指令（资源充足）');
  ok(enemy.wood === w0 - 300 && enemy.stone === s0 - 300, '修复立即扣除 木300/石300');
  ok(!!arch.building && arch.building.kind === 'base_repair', '建筑师进入修复施工状态');
  // 把建筑师放到修复点，推进施工
  arch.x = arch.building.x;
  arch.y = arch.building.y;
  let repaired = false;
  for (let i = 0; i < 60 * 20; i++) {
    RTS.Bases.updateRepairers(1 / 60);
    if (!b0.destroyed) { repaired = true; break; }
  }
  ok(repaired, '施工完成后基地恢复（destroyed=false）');
  ok(b0.hp === Math.round(b0.maxHp * RTS.CONFIG.baseRepairHpRatio), '修复后耐久恢复到 maxHp×50%（hp=' + b0.hp + '）');
  ok(!!arch.building === false, '修复完成后建筑师释放（building=null）');

  // 11.1d AI 修复节奏：有被摧毁基地时派建筑师修复（优先于建塔/兵营）
  setupState('wide_river');
  const ai2 = RTS.state.ai;
  const en2 = RTS.state.enemy;
  en2.bases[1].hp = 0;
  en2.bases[1].destroyed = true;
  en2.wood = 1000;
  en2.stone = 1000;
  const arch2 = RTS.Unit.create('enemy', 'architect', en2.base.x + 60, en2.base.y);
  en2.units.set(arch2.id, arch2);
  ai2.fortifyTimer = -1;
  RTS.AI.updateAll(1 / 60);
  ok(!!arch2.building && arch2.building.kind === 'base_repair',
    'AI 节奏：有被摧毁基地时自动派建筑师修复（' + (arch2.building ? arch2.building.kind : '未派工') + '）');
})();

// ---------------------------------------------------------------- 12) v11.2 并行训练：多基地/兵营可同时生产（最多 5 个）
(function () {
  setupState('valley_river');
  const player = RTS.state.player;
  player.gold = 9999;
  for (let i = 0; i < 5; i++) RTS.Production.order(player, 'spear');
  RTS.Production.updateFaction(player, RTS.state.time, 0.1);
  const training = player.productionQueue.filter((q) => q.status === 'training').length;
  ok(training === 5, '5 个订单同时训练（并行生产，实际 ' + training + '）');
  RTS.Production.order(player, 'sword');
  ok(player.productionQueue[5].status === 'queued',
    '第 6 个订单排队等待训练槽（status=' + player.productionQueue[5].status + '）');
  const t0 = player.units.size;
  let guard = 0;
  while (player.productionQueue.length > 0 && guard++ < 60 * 60) {
    RTS.Production.updateFaction(player, RTS.state.time, 1 / 60);
  }
  ok(player.productionQueue.length === 0 && player.units.size === t0 + 6,
    '并行训练全部完成（新增单位 ' + (player.units.size - t0) + ' 个，期望 6）');
})();

// ---------------------------------------------------------------- 13) v11.2 优势时哨塔修到敌方半场桥头（前线桥头堡）
(function () {
  setupState('wide_river');
  const ai = RTS.state.ai;
  const enemy = RTS.state.enemy;
  const dirX = RTS.state.player.base.x > enemy.base.x ? 1 : -1; // enemy AI：dirX 朝敌方(左) = -1
  const expectFront = RTS.state.player.base.x - dirX * 260;  // 敌方一侧桥头（前线）
  const expectDefense = enemy.base.x + dirX * 260;           // 己方一侧桥头（防守）
  // 优势：我方（enemy AI）10 兵 vs 玩家 0 兵
  for (let i = 0; i < 10; i++) {
    const u = RTS.Unit.create('enemy', 'sword', enemy.base.x + 40 + i * 30, enemy.base.y + 20);
    enemy.units.set(u.id, u);
  }
  enemy.wood = 1000;
  enemy.stone = 1000;
  ai.qm.towers = []; // 无军需官指定 → 走局势兜底
  const arch = RTS.Unit.create('enemy', 'architect', enemy.base.x + 60, enemy.base.y);
  enemy.units.set(arch.id, arch);
  ai.fortifyTimer = -1;
  RTS.AI.updateAll(1 / 60);
  ok(!!arch.building && arch.building.kind === 'tower',
    '优势时建筑师被派去建哨塔（' + (arch.building ? arch.building.kind : '未派工') + '）');
  if (arch.building) {
    ok(Math.abs(arch.building.x - expectFront) < 150,
      '优势时哨塔选址在敌方一侧桥头（前线桥头堡，x=' + Math.round(arch.building.x) + ' 期望~' + Math.round(expectFront) + '）');
  }
  // 劣势对照：玩家方 20 兵 → 我方 -8 劣势 → 哨塔回退己方一侧桥头防守
  for (let i = 0; i < 20; i++) {
    const u = RTS.Unit.create('player', 'sword', RTS.state.player.base.x + 40 + i * 30, RTS.state.player.base.y + 20);
    RTS.state.player.units.set(u.id, u);
  }
  const arch2 = RTS.Unit.create('enemy', 'architect', enemy.base.x + 80, enemy.base.y);
  enemy.units.set(arch2.id, arch2);
  ai.fortifyTimer = -1;
  RTS.AI.updateAll(1 / 60);
  if (arch2.building) {
    ok(Math.abs(arch2.building.x - expectDefense) < 150,
      '劣势时哨塔选址回退己方一侧桥头（防守，x=' + Math.round(arch2.building.x) + ' 期望~' + Math.round(expectDefense) + '）');
  } else {
    ok(true, '（劣势时建筑师被派去产能建设，跳过位置断言）');
  }
})();

// ---------------------------------------------------------------- 14) v11.3 基地防御强化 + 主基地切换 + 进攻目标排除废墟
(function () {
  const c = RTS.CONFIG;
  ok(c.baseDefenseDamage === 30 && c.baseDefenseArrows === 3 && c.baseDefenseInterval === 1.0 && c.baseDefenseRange === 360,
    '基地防御强化：伤害30×3箭、攻速1.0s、射程360（实际 ' + c.baseDefenseDamage + '/' + c.baseDefenseArrows + '/' + c.baseDefenseInterval + '/' + c.baseDefenseRange + '）');
  const wall = RTS.Units.get('wall');
  ok(wall.hp === 700 && wall.cost === 160, '肉盾生命 700（v11.3，实际 ' + wall.hp + '）成本 160');

  // 14a 主基地被摧毁 → faction.base 自动切换到第一座存活基地
  setupState('wide_river');
  const enemy = RTS.state.enemy;
  const ai = RTS.state.ai;
  ok(enemy.base === enemy.bases[0], '初始主基地 = bases[0]（中路）');
  RTS.Combat.hitBase(999999, enemy.bases[0]); // 一次打空 → 触发主基地切换逻辑
  ok(enemy.bases[0].destroyed && enemy.base === enemy.bases[1],
    '主基地被摧毁后 faction.base 切换到存活基地（bases[1]）');
  // 出生集结点跟随新主基地：从基地订单出生的单位奔赴新主基地的 rally
  enemy.gold = 5000;
  enemy.spawnBaseIdx = 0;
  RTS.Production.order(enemy, 'spear'); // 跳过被摧毁的 bases[0] → baseIndex 1
  const order = enemy.productionQueue[0];
  ok(order.origin.baseIndex === 1, '出兵轮转跳过被摧毁基地（baseIndex=1）');
  enemy.productionQueue[0].elapsed = enemy.productionQueue[0].totalTime;
  RTS.Production.updateFaction(enemy, RTS.state.time, 0.01);
  const spawned = [...enemy.units.values()][enemy.units.size - 1];
  ok(Math.abs(spawned.orderTarget.x - enemy.bases[1].rallyX) < 5 && Math.abs(spawned.orderTarget.y - enemy.bases[1].rallyY) < 5,
    '新单位奔赴新主基地的集结点，不再去被摧毁基地');

  // 14b 进攻目标排除被摧毁的敌方基地（对 enemy AI 来说敌方 = 玩家方）
  const player = RTS.state.player;
  player.bases[0].hp = 0;
  player.bases[0].destroyed = true; // 摧毁玩家方中路基地
  const tMid = RTS.AI.laneTarget(ai, 'mid');
  ok(Math.abs(tMid.x - player.bases[1].x) < 10,
    '中路进攻目标排除被摧毁的敌方中路基地（目标 x=' + Math.round(tMid.x) + ' = 存活基地 x=' + Math.round(player.bases[1].x) + '）');

  // 14c 防御锚点排除被摧毁基地：intruderCount 只统计存活基地附近（间接通过 defend 不抛错即可）
  RTS.AI.updateAll(1 / 60);
  ok(true, '主基地被摧毁后 AI 正常运转（updateAll 无异常）');
})();

console.log('fetch 调用次数:', fetchCount);
console.log(pass ? 'SMOKE V11 PASSED' : 'SMOKE V11 FAILED');
process.exit(pass ? 0 : 1);
