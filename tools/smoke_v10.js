'use strict';

/**
 * v10 冒烟测试：四级指挥链（主将/进攻副将/防守副将/军需官）+ 逐单位微指令
 *
 * 验证：
 *   1. 主将决策应用（态势 + 三条下属指令转发）
 *   2. 进攻副将 orders → 逐单位微指令（3 个斥候 → 3 座不同的金矿）
 *   3. 防守副将 orders → 桥头驻守微指令
 *   4. 军需官 production 计划驱动生产 / upgrade / towers（哨塔选址）
 *   5. 微指令占用：普通态势执行器不抢已被占用的单位
 *   6. 紧急撤退强制接管（清除）微指令单位
 *   7. 微指令过期自动释放
 *   8. 巡逻（patrol）/风筝（kite）新单位状态机
 *   9. 新增态势（guerrilla/priority_defense/sneak/hold_line）可执行不报错
 * 运行：node tools/smoke_v10.js
 */

const fs = require('fs');
const vm = require('vm');

global.window = global;
global.RTS = global.RTS || {};
global.RTS.UI = { toast: () => {}, aiMessage: (side, text) => { if (global.__aiMsgs) global.__aiMsgs.push(side + ':' + text); } };
global.__aiMsgs = [];

let fetchCount = 0;
global.fetch = async (url, opts) => {
  fetchCount++;
  const payload = JSON.parse(opts.body);
  let decision = null;
  switch (payload.role) {
    case 'offense':
      decision = { orders: [{ task: 'capture', group: 'scout', count: 3, target: 'gold' }], comment: '斥候分三路抢金矿' };
      break;
    case 'defense':
      decision = { orders: [{ task: 'hold', group: 'spear', count: 2, target: 'choke', lane: 'mid' }], comment: '长矛守中路桥头' };
      break;
    case 'quartermaster':
      decision = {
        production: [{ type: 'scout', count: 2 }, { type: 'spear', count: 2 }],
        upgrade: 'attack',
        towers: [{ spot: 'choke_mid', priority: 1 }],
        comment: '生产斥候与长矛，升级军备',
      };
      break;
    default:
      decision = {
        stance: 'capture_gold',
        armyFocus: 'scout',
        aggression: 60,
        lane: 'mid',
        targetFocus: 'econ',
        offenseDirective: '斥候抢占金矿',
        defenseDirective: '守住桥头',
        economyDirective: '多造斥候与长矛',
        attackNow: false,
        comment: '主将意图',
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
  'public/js/resources.js', 'public/js/projectiles.js', 'public/js/towers.js', 'public/js/barracks.js', 'public/js/ai.js',
];
for (const f of files) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });

(async () => {
  const map = RTS.Maps.get('valley_river');
  RTS.Maps.activate('valley_river');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  const mkFaction = (owner, base) => ({
    owner, gold: 600, goldRate: 20, wood: 300, woodRate: 0, stone: 300, stoneRate: 0,
    populationCap: 100, base, productionQueue: [], units: new Map(),
    upgrades: { attack: 0, armor: 0, defense: 0, siegecraft: 0, mobility: 0 },
  });
  RTS.state = {
    time: 0, phase: 'running', fps: 0, debugMode: false,
    player: mkFaction('player', bases.player[0]),
    enemy: mkFaction('enemy', bases.enemy[0]),
    selection: new Set(), selectedBase: null,
    damageNumbers: [],
    resources: { nodes: RTS.World.placeResources(map) },
    corpses: [],
    towers: [],
    barracks: [], // v10.2
    ai: RTS.AI.init('enemy', 'deepseek'),
    playerAI: null,
  };

  const enemy = RTS.state.enemy;
  const ai = RTS.state.ai;

  // 给敌方造一些单位：4 斥候 + 4 长矛 + 2 弓箭手（分布在基地附近）
  const scoutUnits = [];
  const spearUnits = [];
  for (let i = 0; i < 4; i++) {
    const s = RTS.Unit.create('enemy', 'scout', enemy.base.x + 40 + i * 30, enemy.base.y - 20);
    enemy.units.set(s.id, s);
    scoutUnits.push(s);
  }
  for (let i = 0; i < 4; i++) {
    const sp = RTS.Unit.create('enemy', 'spear', enemy.base.x + 40 + i * 30, enemy.base.y + 30);
    enemy.units.set(sp.id, sp);
    spearUnits.push(sp);
  }
  const archer1 = RTS.Unit.create('enemy', 'archer', enemy.base.x + 60, enemy.base.y + 80);
  const archer2 = RTS.Unit.create('enemy', 'archer', enemy.base.x + 90, enemy.base.y + 80);
  enemy.units.set(archer1.id, archer1);
  enemy.units.set(archer2.id, archer2);
  const baseUnitCount = enemy.units.size;

  let pass = true;
  const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg); if (!cond) pass = false; };

  // 泵步进工具：等待某个条件成立（推进游戏时间 + 让 fetch 微任务落地）
  const STEP = 1 / 60;
  async function waitFor(pred, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < (maxMs || 12000)) {
      if (pred()) return true;
      RTS.state.time += STEP;
      RTS.AI.updateAll(STEP);
      await new Promise((r) => setTimeout(r, 5));
    }
    return false;
  }

  // 基础断言：新态势在清单中
  ok(RTS.AI.STANCE_LIST.includes('guerrilla') && RTS.AI.STANCE_LIST.includes('priority_defense') &&
     RTS.AI.STANCE_LIST.includes('sneak') && RTS.AI.STANCE_LIST.includes('hold_line'),
    'STANCE_LIST 包含 4 个新态势');

  // ---- 1) 主将 ----
  await waitFor(() => ai.deepseekEverActive);
  ok(ai.deepseekEverActive, '主将决策已成功接管（everActive）');
  ok(ai.phase === 'capture_gold', '主将态势生效：capture_gold（实际 ' + ai.phase + '）');
  ok(ai.strategy.offenseDirective === '斥候抢占金矿' && ai.strategy.defenseDirective === '守住桥头' &&
     ai.strategy.economyDirective === '多造斥候与长矛', '三条下属指令已转发');

  // ---- 2) 进攻副将 → 逐单位微指令 ----
  await waitFor(() => ai.offenseActive);
  ok(ai.offenseActive, '进攻副将已接管');
  ok(ai.offenseCount > 0, '进攻副将发起过请求');
  const captureMicros = scoutUnits.filter((u) => u.microOrder && u.microOrder.kind === 'capture');
  ok(captureMicros.length >= 3, '至少 3 个斥候被派去抢金矿（实际 ' + captureMicros.length + '）');
  const nodeIds = new Set(captureMicros.map((u) => u.microOrder.nodeId).filter(Boolean));
  ok(nodeIds.size >= 3, '斥候奔赴 ' + nodeIds.size + ' 座不同的金矿（期望 ≥3 座，逐单位分发）');

  // ---- 3) 防守副将 → 桥头驻守 ----
  await waitFor(() => ai.defenseActive);
  ok(ai.defenseActive, '防守副将已接管');
  ok(ai.defenseCount > 0, '防守副将发起过请求');
  const holdMicros = spearUnits.filter((u) => u.microOrder && (u.microOrder.kind === 'hold' || u.microOrder.kind === 'defend'));
  ok(holdMicros.length >= 1, '长矛收到桥头驻守微指令（实际 ' + holdMicros.length + '）');

  // ---- 4) 军需官 ----
  await waitFor(() => ai.qmActive);
  ok(ai.qmActive, '军需官已接管');
  ok(ai.qmCount > 0, '军需官发起过请求');
  ok(ai.qm.plan.length > 0 && ai.qm.plan[0].type === 'scout', '军需官生产计划已应用');
  ok(ai.qm.upgrade === 'attack', '军需官指定升级 attack');
  ok(ai.qm.towers.length > 0 && ai.qm.towers[0].spot === 'choke_mid', '军需官指定哨塔选址 choke_mid');

  // ---- 生产计划驱动 + 升级 ----
  await waitFor(() => enemy.productionQueue.some((q) => q.type === 'scout' || q.type === 'spear') || enemy.units.size > baseUnitCount);
  const inPlan = enemy.productionQueue.some((q) => q.type === 'scout' || q.type === 'spear');
  ok(inPlan || enemy.units.size > baseUnitCount, '军需官计划驱动生产（队列出现斥候/长矛，队列 ' + enemy.productionQueue.length + '）');
  await waitFor(() => enemy.upgrades.attack >= 1);
  ok(enemy.upgrades.attack >= 1, '军需官指定科技已研究（attack Lv' + enemy.upgrades.attack + '）');

  // ---- 关闭后续 LLM 请求：以下为纯执行器测试（微指令占用/撤退/过期/巡逻/风筝/新态势），
  //      避免异步决策在断言间隙落地导致时序抖动 ----
  ai.deepseekNextAt = Infinity;
  ai.offenseNextAt = Infinity;
  ai.defenseNextAt = Infinity;
  ai.qmNextAt = Infinity;

  // ---- 5) 微指令占用：普通态势执行器不得再指挥这些斥候 ----
  // （先冻结微指令有效期，避免采样期间过期释放导致时序抖动）
  scoutUnits.forEach((u) => { if (u.microOrder) u.microOrder.until = RTS.state.time + 300; });
  const scoutBefore = scoutUnits.map((u) => u.microOrder && u.microOrder.kind);
  ai.phase = 'rally';
  ai.phaseChanged = true;
  RTS.AI.updateAll(STEP);
  const scoutAfter = scoutUnits.map((u) => u.microOrder && u.microOrder.kind);
  ok(JSON.stringify(scoutAfter) === JSON.stringify(scoutBefore), '集结态势不抢已被占用的斥候（微指令占用生效）');

  // ---- 6) 筑垒：军需官选址（军需官 towers 已就绪） ----
  enemy.wood = 300;
  enemy.stone = 300;
  const arch = RTS.Unit.create('enemy', 'architect', enemy.base.x + 60, enemy.base.y);
  enemy.units.set(arch.id, arch);
  ai.phase = 'fortify';
  ai.phaseChanged = true;
  await waitFor(() => !!arch.building);
  const chokeX = enemy.base.x + (bases.player[0].x > enemy.base.x ? 1 : -1) * 260;
  const chokeY = 32 * RTS.CONFIG.tileSize;
  ok(!!arch.building, '建筑师收到筑垒指令（军需官选址）');
  if (arch.building) {
    ok(Math.hypot(arch.building.x - chokeX, arch.building.y - chokeY) < 80,
      '建筑师前往军需官指定位置 choke_mid（实际 (' + Math.round(arch.building.x) + ',' + Math.round(arch.building.y) + ')）');
  }

  // ---- 7) 紧急撤退强制接管微指令单位 ----
  ai.phase = 'retreat';
  ai.phaseChanged = true;
  RTS.AI.updateAll(STEP);
  const anyMicroAfterRetreat = scoutUnits.some((u) => u.microOrder);
  ok(!anyMicroAfterRetreat, '紧急撤退清除了斥候的微指令并拉回基地');

  // ---- 8) 微指令过期自动释放 ----
  const testUnit = RTS.Unit.create('enemy', 'scout', enemy.base.x + 100, enemy.base.y);
  enemy.units.set(testUnit.id, testUnit);
  testUnit.microOrder = {
    kind: 'hold', x: enemy.base.x + 200, y: enemy.base.y,
    radius: 40, until: RTS.state.time + 100, source: 'test',
  };
  RTS.Unit.orderAttackMove(testUnit, enemy.base.x + 200, enemy.base.y);
  testUnit.microOrder.until = RTS.state.time - 1; // 已过期
  RTS.AI.updateAll(STEP);
  ok(!testUnit.microOrder, '过期微指令被自动清除');

  // ---- 9) 巡逻状态机 ----
  const pat = RTS.Unit.create('enemy', 'scout', enemy.base.x + 300, enemy.base.y);
  enemy.units.set(pat.id, pat);
  const wpA = { x: enemy.base.x + 300, y: enemy.base.y };
  const wpB = { x: enemy.base.x + 300, y: enemy.base.y + 200 };
  pat.microOrder = { kind: 'patrol', x: wpA.x, y: wpA.y, waypoints: [wpA, wpB], wpIndex: 0, until: RTS.state.time + 100, source: 'test' };
  RTS.Unit.orderAttackMove(pat, wpA.x, wpA.y);
  pat.x = wpA.x; pat.y = wpA.y;
  pat.state = 'idle';
  pat.orderTarget = null;
  RTS.Unit.update(pat, STEP);
  ok(pat.microOrder.wpIndex === 1 && pat.orderTarget && Math.hypot(pat.orderTarget.x - wpB.x, pat.orderTarget.y - wpB.y) < 2,
    '巡逻到达路点后推进到下一个路点（wpIndex=' + pat.microOrder.wpIndex + '）');

  // ---- 10) 风筝状态机（位置放在地图内） ----
  const archerK = RTS.Unit.create('enemy', 'archer', enemy.base.x + 200, enemy.base.y);
  enemy.units.set(archerK.id, archerK);
  const dummy = RTS.Unit.create('player', 'sword', archerK.x + 30, archerK.y); // 贴脸近战
  RTS.state.player.units.set(dummy.id, dummy);
  archerK.microOrder = { kind: 'kite', x: archerK.x, y: archerK.y, radius: 100, until: RTS.state.time + 100, source: 'test' };
  archerK.attackTarget = { kind: 'unit', ref: dummy };
  archerK.state = 'attack';
  const xBefore = archerK.x;
  RTS.Unit.update(archerK, STEP);
  ok(archerK.x < xBefore, '远程单位风筝后撤（x ' + xBefore.toFixed(1) + ' → ' + archerK.x.toFixed(1) + '）');
  RTS.state.player.units.delete(dummy.id);

  // ---- 11) 新增态势可执行不报错 ----
  let stanceOk = true;
  for (const stance of ['guerrilla', 'priority_defense', 'sneak', 'hold_line']) {
    try {
      ai.phase = stance;
      ai.phaseChanged = true;
      ai.commandTimer = 0;
      ai.nodeTimer = 0;
      ai.nextAttackTime = RTS.state.time;
      RTS.AI.updateAll(STEP);
    } catch (e) {
      stanceOk = false;
      console.log('  态势 ' + stance + ' 抛错: ' + e.message);
    }
  }
  ok(stanceOk, '新增态势（游击/重点防守/偷家/防线推进）执行无异常');

  // ---- 12) 玩家手动指令清除微指令（通过 clearMicro API） ----
  const manualUnit = scoutUnits[0];
  manualUnit.microOrder = { kind: 'hold', x: 0, y: 0, radius: 40, until: RTS.state.time + 100, source: 'test' };
  RTS.Unit.clearMicro(manualUnit);
  ok(!manualUnit.microOrder, 'RTS.Unit.clearMicro 清除微指令（玩家手动下令路径）');

  // ---- 13) 斥候抢占链（确定性状态机：完全占领+安全确认后才续接最近下一座，不折返） ----
  ai.phase = 'build'; // 无操作态势，避免执行器干扰
  ai.phaseChanged = true;
  const nodeA = RTS.state.resources.nodes.find((n) => n.owner !== 'enemy');
  const chainScout = RTS.Unit.create('enemy', 'scout', enemy.base.x + 100, enemy.base.y);
  enemy.units.set(chainScout.id, chainScout);
  chainScout.microOrder = {
    kind: 'capture', x: nodeA.x, y: nodeA.y, radius: nodeA.radius * 0.8, nodeId: nodeA.id,
    until: RTS.state.time + 300, source: 'test',
  };
  RTS.Unit.orderAttackMove(chainScout, nodeA.x, nodeA.y);
  const oldOwner = nodeA.owner;
  const otherUnowned = RTS.state.resources.nodes.filter((n) => n.owner !== 'enemy');
  if (otherUnowned.length > 0) {
    // v11：仅归己方但未完全占领（control 未到 ±1）→ 先驻守等待，不续接
    nodeA.owner = 'enemy';
    nodeA.control = 0.5;
    RTS.AI.updateAll(STEP);
    ok(!!chainScout.microOrder && chainScout.microOrder.nodeId === nodeA.id,
      '抢占链：未完全占领时不续接（等待完全占领）');
    // 完全占领 + 安全，且满 settle 时长 → 续接最近下一座
    nodeA.control = 1;
    RTS.AI.updateAll(STEP); // 第一拍：开始「完全占领确认」计时
    RTS.state.time += RTS.CONFIG.aiScoutCaptureSettleTime + 1;
    RTS.AI.updateAll(STEP); // 第二拍：满确认时长 → 续接下一据点
    ok(!!chainScout.microOrder && chainScout.microOrder.nodeId !== nodeA.id,
      '抢占链：完全占领并等待确认后自动续接下一个无主资源点（#' + nodeA.id + ' → #' + (chainScout.microOrder ? chainScout.microOrder.nodeId : '?') + '）');
  } else {
    ok(!chainScout.microOrder, '抢占链：无主节点占完后释放');
  }
  nodeA.owner = oldOwner;
  nodeA.control = 0;
  RTS.Unit.clearMicro(chainScout);

  // ---- 14) 筑垒节奏（确定性，不依赖 fortify 态势）：资源富余 → 自产建筑师并派工 ----
  const oldTime = RTS.state.time;
  RTS.state.time = 100; // 越过「前期发育不造建筑师」门槛
  enemy.wood = 300;
  enemy.stone = 300;
  ai.qm.plan = [];
  ai.qm.towers = [{ spot: 'choke_top', priority: 1 }];
  ai.fortifyTimer = -1;
  RTS.AI.updateAll(STEP);
  const archInQueue = enemy.productionQueue.some((q) => q.type === 'architect');
  const archAlive = [...enemy.units.values()].some((u) => u.type === 'architect' && u.hp > 0);
  ok(archInQueue || archAlive, '筑垒节奏：资源富余时自动生产建筑师');
  const arch2 = RTS.Unit.create('enemy', 'architect', enemy.base.x + 60, enemy.base.y);
  enemy.units.set(arch2.id, arch2);
  ai.fortifyTimer = -1;
  RTS.AI.updateAll(STEP);
  ok(!!arch2.building, '筑垒节奏：闲置建筑师被自动派往军需官选址（' + (arch2.building ? '已施工' : '未派工') + '）');
  RTS.state.time = oldTime;

  // ---- 15) 兵营生命周期：建筑师建造 → 施工 → 立起占位 ----
  ai.deepseekNextAt = Infinity;
  ai.offenseNextAt = Infinity;
  ai.defenseNextAt = Infinity;
  ai.qmNextAt = Infinity;
  enemy.wood = 400;
  enemy.stone = 400;
  const barArch = RTS.Unit.create('enemy', 'architect', enemy.base.x + 60, enemy.base.y);
  enemy.units.set(barArch.id, barArch);
  const barSpot = RTS.World.nearestWalkablePx(enemy.base.x - 160, enemy.base.y - 170);
  const w0 = enemy.wood;
  const s0 = enemy.stone;
  const resB = RTS.Barracks.orderBuild(barArch, barSpot.x, barSpot.y);
  ok(resB.ok, '建筑师可下达建造兵营指令（资源充足）');
  ok(enemy.wood === w0 - RTS.CONFIG.barracksBuildCost.wood && enemy.stone === s0 - RTS.CONFIG.barracksBuildCost.stone,
    '建造兵营立即扣除木/石');
  ok(!!barArch.building && barArch.building.kind === 'barracks', '建筑师进入兵营施工状态');
  barArch.x = barSpot.x;
  barArch.y = barSpot.y;
  let barracksUp = false;
  for (let i = 0; i < 60 * 8; i++) {
    RTS.Barracks.updateBuilders(STEP);
    if (RTS.state.barracks.length > 0) { barracksUp = true; break; }
  }
  ok(barracksUp, '施工完成后兵营立起（barracks.length=' + RTS.state.barracks.length + '）');
  const br = RTS.state.barracks[0];
  ok(!!br && br.owner === 'enemy' && br.hp === RTS.CONFIG.barracksMaxHp, '兵营归属与耐久正确');
  const brTile = RTS.World.worldToTile(br.x, br.y);
  ok(!RTS.World.isWalkable(brTile.tx, brTile.ty), '兵营占位成为不可通行障碍');

  // ---- 16) 队列溢出分担：基地队列 ≥3 时，第 4 个订单从兵营出生 ----
  enemy.gold = 2000;
  enemy.productionQueue.length = 0; // 清空前面测试段落累积的订单
  RTS.Production.order(enemy, 'spear');
  RTS.Production.order(enemy, 'spear');
  RTS.Production.order(enemy, 'spear');
  ok(enemy.productionQueue.length === 3 && enemy.productionQueue.every((q) => q.origin.kind === 'base'),
    '基地队列前 3 个订单从基地出生');
  RTS.Production.order(enemy, 'sword');
  const fourth = enemy.productionQueue[3];
  ok(fourth.origin.kind === 'barracks' && fourth.origin.id === br.id,
    '基地队列超过 3 个后，第 4 个订单从兵营出生（origin=' + fourth.origin.kind + '）');
  const brBefore = enemy.units.size;
  // 先让前 3 个（基地）订单完成，使 sword 成为队头
  for (let k = 0; k < 3; k++) {
    enemy.productionQueue[0].elapsed = enemy.productionQueue[0].totalTime;
    RTS.Production.updateFaction(enemy, RTS.state.time, 0.01);
  }
  ok(enemy.productionQueue[0].origin.kind === 'barracks', '前 3 个基地订单完成后，队头为兵营订单');
  const sizeBeforeSword = enemy.units.size;
  enemy.productionQueue[0].elapsed = enemy.productionQueue[0].totalTime;
  RTS.Production.updateFaction(enemy, RTS.state.time, 0.01);
  const spawned = [...enemy.units.values()][enemy.units.size - 1];
  ok(enemy.units.size === sizeBeforeSword + 1 && spawned.type === 'sword' &&
     Math.hypot(spawned.x - br.x, spawned.y - br.y) < 200,
    '从兵营出生的单位出现在兵营附近（type=' + spawned.type + ' dist=' + Math.round(Math.hypot(spawned.x - br.x, spawned.y - br.y)) + 'px）');
  const noBarFaction = RTS.state.player;
  noBarFaction.gold = 2000;
  for (let i = 0; i < 4; i++) RTS.Production.order(noBarFaction, 'spear');
  ok(noBarFaction.productionQueue.every((q) => q.origin.kind === 'base'),
    '无兵营时所有订单从基地出生');

  // ---- 17) 兵营可被攻击摧毁，摧毁后恢复可通行 ----
  const attacker = RTS.Unit.create('player', 'hammer', br.x + br.radius + 40, br.y);
  RTS.state.player.units.set(attacker.id, attacker);
  attacker.attackTarget = { kind: 'barracks', ref: br };
  attacker.state = 'attack';
  let brDestroyed = false;
  for (let i = 0; i < 60 * 120; i++) { // 锤子兵 1500 耐久需 ~85s
    RTS.Combat.rebuildHash();
    RTS.Unit.update(attacker, STEP);
    if (br.hp <= 0) { brDestroyed = true; break; }
  }
  ok(brDestroyed, '锤子兵能摧毁兵营（耗时 ' + (brDestroyed ? Math.round(RTS.state.time) : '超时') + 's）');
  ok(RTS.state.barracks.length === 0, '兵营销毁后从列表移除');
  const brTileAfter = RTS.World.worldToTile(barSpot.x, barSpot.y);
  ok(RTS.World.isWalkable(brTileAfter.tx, brTileAfter.ty), '兵营销毁后地形恢复可通行');

  // ---- 18) AI 兵营节奏：经济强 + 队列拥堵 → 自动派建筑师建兵营（确定性） ----
  // v11.2：兵营在「劣势/均势」时优先（优势时优先建前线哨塔），这里让玩家方兵力占优触发兵营分支
  enemy.wood = 300;
  enemy.stone = 300;
  enemy.gold = 2000;
  enemy.goldRate = 60; // 模拟经济强（含金矿）
  for (let i = 0; i < 30; i++) {
    const du = RTS.Unit.create('player', 'sword', RTS.state.player.base.x + 40 + i * 30, RTS.state.player.base.y + 30);
    RTS.state.player.units.set(du.id, du);
  }
  ai.queueCongestionTime = 20; // 模拟基地队列持续拥堵（≥10s）
  ai.fortifyTimer = -1;
  const arch3 = RTS.Unit.create('enemy', 'architect', enemy.base.x + 60, enemy.base.y);
  enemy.units.set(arch3.id, arch3);
  RTS.AI.updateAll(STEP);
  const anyBarrackBuild = [...enemy.units.values()].some((u) => u.building && u.building.kind === 'barracks');
  ok(anyBarrackBuild,
    'AI 兵营节奏：经济强+队列拥堵（劣势方）时自动派建筑师建兵营（' + (anyBarrackBuild ? 'barracks' : '未派工') + '）');

  console.log('AI 消息示例:', global.__aiMsgs.slice(0, 5));
  console.log('fetch 调用次数:', fetchCount, '(含四角色)');
  console.log(pass ? 'SMOKE V10 PASSED' : 'SMOKE V10 FAILED');
  process.exit(pass ? 0 : 1);
})();
