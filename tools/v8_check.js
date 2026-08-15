'use strict';

/**
 * v8 验证脚本：新地图连通性 / 新兵种数值 / 五线科技效果
 * 运行：node tools/v8_check.js
 */

const fs = require('fs');
const vm = require('vm');

global.window = global;
global.RTS = global.RTS || {};
global.RTS.UI = { toast: () => {}, aiMessage: () => {} };

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

let pass = true;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg); if (!cond) pass = false; };

// ---------------------------------------------------------------- 1) 大图连通性
(function () {
  const map = RTS.Maps.get('grand_basin');
  RTS.Maps.activate('grand_basin');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  const nodes = RTS.World.placeResources(map);
  ok(RTS.world.W === 128 && RTS.world.H === 128, 'grand_basin 尺寸 128×128');

  const p = { x: bases.player.x, y: bases.player.y };
  const e = { x: bases.enemy.x, y: bases.enemy.y };
  const path = RTS.Pathfinding.findPath(p.x, p.y, e.x, e.y);
  ok(!!path && path.length > 0, '大图 玩家基地→敌方基地 可寻路（路径点 ' + (path ? path.length : 0) + '）');
  const mid = path ? path[Math.floor(path.length / 2)] : null;
  if (mid) ok(RTS.World.isWalkablePx(mid.x, mid.y), '路径中点可通行');

  let allWalk = true;
  for (const n of nodes) {
    if (!RTS.World.isWalkablePx(n.x, n.y)) { allWalk = false; console.log('  资源点不可走:', n.type, n.x, n.y); }
  }
  ok(allWalk, '全部 ' + nodes.length + ' 个资源点可通行');
  const counts = {};
  nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
  ok(counts.gold === 8 && counts.wood === 12 && counts.stone === 14,
    '资源分布 金8/木12/石14 = 实际 ' + JSON.stringify(counts) + '（共 ' + nodes.length + ' 座）');

  // 三条通道 laneY 均落在桥梁上
  for (const l of map.lanes) {
    const y = l.ty * RTS.CONFIG.tileSize;
    const tx = 63 * RTS.CONFIG.tileSize + 24;
    ok(RTS.World.isWalkablePx(tx, y), '通道 ' + l.id + ' 渡河点可通行 (y=' + y + ')');
  }
  RTS.Maps.activate(RTS.CONFIG.defaultMap);
})();

// ---------------------------------------------------------------- 2) 新兵种数值与克制
(function () {
  const ids = RTS.Units.ids();
  ok(ids.length === 10, '注册表共 10 个兵种 = ' + ids.join(','));
  for (const id of ['hammer', 'horse_archer', 'wall', 'scout', 'architect']) ok(RTS.Units.has(id), '新兵种已注册: ' + id);
  const h = RTS.Units.get('hammer');
  ok(h.bonusVs.wall === 1.4, '锤子兵克制肉盾 ×1.4');
  ok(h.bonusVs.sword === 1.4, '锤子兵克制刀盾 ×1.4');
  ok(h.baseMul === 1.5, '锤子兵攻城对基地 ×1.5');
  const ha = RTS.Units.get('horse_archer');
  ok(ha.ranged && ha.speed === 3.8, '骑射手为远程且高速');
  ok(ha.bonusVs.hammer === 1.3, '骑射手克制锤子兵 ×1.3');
  const w = RTS.Units.get('wall');
  ok(w.hp === 320 && w.bonusVs.cavalry === 1.3, '肉盾高生命且克骑兵 ×1.3');

  // v9：斥候全场最快 / 建筑师有建造定位
  const sc = RTS.Units.get('scout');
  ok(!!sc && sc.speed === 5.6, '斥候移速 5.6 格/s（全场最快）');
  ok(sc.tags.includes('fast') && sc.tags.includes('scout'), '斥候带 fast/scout 标签');
  const ar = RTS.Units.get('architect');
  ok(!!ar && ar.tags.includes('builder'), '建筑师带 builder 标签');
  ok(RTS.CONFIG.towerBuildCost.wood === 60 && RTS.CONFIG.towerBuildCost.stone === 60, '哨塔造价 木60/石60');

  // 克制闭环抽查：肉盾克骑兵 → 骑兵克弓箭 → 长矛克骑兵（互不碾压）
  const spear = RTS.Units.get('spear');
  const cavalry = RTS.Units.get('cavalry');
  ok(spear.bonusVs.cavalry === 1.6 && cavalry.bonusVs.spear === 0.7, '长矛⇄骑兵克制闭环');
  ok(w.bonusVs.cavalry > 1 && cavalry.bonusVs.archer > 1, '肉盾/骑兵各有所克');
  RTS.state = null;
})();

// ---------------------------------------------------------------- 3) 五线科技效果
(function () {
  const map = RTS.Maps.get('valley_river');
  RTS.Maps.activate('valley_river');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  const mkFaction = (owner, base) => ({
    owner, gold: 99999, goldRate: 5, wood: 99999, stone: 99999,
    populationCap: 100, base, productionQueue: [], units: new Map(),
    upgrades: { attack: 0, armor: 0, defense: 0, siegecraft: 0, mobility: 0 },
  });
  RTS.state = {
    time: 0, phase: 'running', fps: 0, debugMode: false,
    player: mkFaction('player', bases.player),
    enemy: mkFaction('enemy', bases.enemy),
    selection: new Set(), selectedBase: null,
    damageNumbers: [],
    resources: { nodes: RTS.World.placeResources(map) },
    corpses: [],
    ai: RTS.AI.init('enemy', 'deepseek'),
    playerAI: null,
  };
  const pl = RTS.state.player;

  ok(RTS.CONFIG.upgradeMaxLevel === 5, '科技最高等级 = 5');
  ok(Object.keys(RTS.CONFIG.upgrades).length === 5, '科技共 5 线');

  // 全部升满：每一线都能到 5 级，且第 6 次被拒
  for (const track of ['attack', 'armor', 'defense', 'siegecraft', 'mobility']) {
    for (let i = 0; i < 5; i++) {
      const okUp = RTS.Resources.canUpgrade(pl, track).ok;
      const done = RTS.Resources.upgrade(pl, track);
      if (!okUp || !done) { console.log('  FAIL 升级中断:', track, '第', i + 1, '次'); pass = false; }
    }
    ok(pl.upgrades[track] === 5, '科技 ' + track + ' 满级 5');
    ok(!RTS.Resources.canUpgrade(pl, track).ok, '科技 ' + track + ' 满级后不可再升');
    ok(RTS.Resources.upgradeCost(pl, track) === null, '科技 ' + track + ' 满级后成本为 null');
  }

  // 效果挂接
  const u = RTS.Unit.create('player', 'sword', bases.player.x + 100, bases.player.y);
  const baseSpeed = RTS.Units.get('sword').speed * RTS.CONFIG.speedScale;
  ok(Math.abs(u.speed - baseSpeed * (1 + 5 * 0.06)) < 0.001, '疾行军 5 级：新单位移速 +30% (' + u.speed.toFixed(1) + ' px/s)');
  ok(RTS.Resources.siegeMul('player') === 1 + 5 * 0.10, '破城技术 5 级：对基地伤害 ×1.5');
  const atk = RTS.Resources.effectiveAttack(u);
  ok(atk === 13 * (1 + 5 * 0.12), '军备锻造 5 级：攻击 +60%');

  // 基地伤害实际结算
  const before = pl.base.hp;
  RTS.Combat.deliverAttack(u, { kind: 'base', ref: pl.base });
  const dealt = before - pl.base.hp;
  const expect = Math.max(1, Math.floor(atk * RTS.CONFIG.baseDamageMultiplier * 1.5));
  ok(dealt === expect, '对基地伤害含破城倍率：' + dealt + ' = 期望 ' + expect);

  // AI 升级逻辑能走到新科技（防御/攻击/护甲满级后升破城/疾行）
  // st.ai 控制敌方阵营，先手动把敌方攻/护/城防升满，再观察 AI 是否继续点新科技
  const ai = RTS.state.ai;
  const enemyF = RTS.state.enemy;
  for (const track of ['attack', 'armor', 'defense']) {
    while (enemyF.upgrades[track] < 5) RTS.Resources.upgrade(enemyF, track);
  }
  ai.deepseekEverActive = true;
  ai.deepseekNextAt = Infinity; // 关闭 LLM 请求，专注 aiUpgrade 路径
  const STEP = 1 / 60;
  for (let i = 0; i < 60 * 60 * 4; i++) { // 模拟 4 分钟
    RTS.state.time += STEP;
    RTS.AI.updateAll(STEP); // upgradeTimer 每 4s 触发一次 aiUpgrade
  }
  ok(enemyF.upgrades.siegecraft > 0 && enemyF.upgrades.mobility > 0,
    'AI 在攻/护/城防满级后继续点破城(' + enemyF.upgrades.siegecraft + ')与疾行(' + enemyF.upgrades.mobility + ')');

  RTS.state = null;
})();

// ---------------------------------------------------------------- 4) v9：哨塔生命周期 + 分队指令
(function () {
  const map = RTS.Maps.get('valley_river');
  RTS.Maps.activate('valley_river');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  const mkFaction = (owner, base) => ({
    owner, gold: 99999, goldRate: 5, wood: 99999, stone: 99999,
    populationCap: 100, base, productionQueue: [], units: new Map(),
    upgrades: { attack: 0, armor: 0, defense: 0, siegecraft: 0, mobility: 0 },
  });
  RTS.state = {
    time: 0, phase: 'running', fps: 0, debugMode: false,
    player: mkFaction('player', bases.player),
    enemy: mkFaction('enemy', bases.enemy),
    selection: new Set(), selectedBase: null,
    damageNumbers: [],
    resources: { nodes: RTS.World.placeResources(map) },
    corpses: [],
    towers: [],
    ai: RTS.AI.init('enemy', 'deepseek'),
    playerAI: null,
  };
  const pl = RTS.state.player;
  const en = RTS.state.enemy;
  const STEP = 1 / 60;

  // ---- 4.1 建筑师建造哨塔：资源扣除 → 施工 → 立塔 → 成为障碍
  const spot = RTS.World.nearestWalkablePx(pl.base.x + 260, pl.base.y);
  const architect = RTS.Unit.create('player', 'architect', pl.base.x + 100, pl.base.y);
  pl.units.set(architect.id, architect);
  const woodBefore = pl.wood;
  const stoneBefore = pl.stone;
  const res = RTS.Towers.orderBuild(architect, spot.x, spot.y);
  ok(res.ok, '建筑师可下达建造指令（资源充足）');
  ok(pl.wood === woodBefore - 60 && pl.stone === stoneBefore - 60, '建造指令立即扣除 木60/石60');
  ok(!!architect.building, '建筑师进入施工状态 building');

  // 把建筑师瞬移到建造点附近，推进施工
  architect.x = spot.x;
  architect.y = spot.y;
  let built = false;
  for (let i = 0; i < 60 * 6; i++) {
    RTS.Towers.updateArchitects(STEP);
    if (RTS.state.towers.length > 0) { built = true; break; }
  }
  ok(built, '施工 3.5s 后哨塔立起（towers.length=' + RTS.state.towers.length + '）');
  ok(!architect.building, '完工后建筑师恢复空闲');
  const tower = RTS.state.towers[0];
  ok(!!tower && tower.owner === 'player' && tower.hp === RTS.CONFIG.towerMaxHp, '哨塔归属与耐久正确');
  const tileAtTower = RTS.World.worldToTile(tower.x, tower.y);
  ok(!RTS.World.isWalkable(tileAtTower.tx, tileAtTower.ty), '哨塔占位成为不可通行障碍');

  // ---- 4.2 哨塔自动射箭攻击敌方单位
  const dummy = RTS.Unit.create('enemy', 'sword', tower.x + 120, tower.y);
  en.units.set(dummy.id, dummy);
  const dummyHp0 = dummy.hp;
  for (let i = 0; i < 60 * 4; i++) {
    RTS.Combat.rebuildHash();
    RTS.Towers.update(STEP);
    RTS.Projectiles.update(STEP);
    if (dummy.hp < dummyHp0) break;
  }
  ok(dummy.hp < dummyHp0, '哨塔射出的塔箭命中敌方单位（' + (dummyHp0 - dummy.hp) + ' 伤害）');

  // ---- 4.3 单位可攻击并摧毁哨塔；销毁后恢复可通行
  const attacker = RTS.Unit.create('player', 'hammer', tower.x + tower.radius + 40, tower.y);
  pl.units.set(attacker.id, attacker);
  attacker.attackTarget = { kind: 'tower', ref: tower };
  attacker.state = 'attack';
  let destroyed = false;
  for (let i = 0; i < 60 * 60; i++) {
    RTS.Combat.rebuildHash();
    RTS.Unit.update(attacker, STEP);
    if (tower.hp <= 0) { destroyed = true; break; }
  }
  ok(destroyed, '锤子兵能摧毁哨塔');
  ok(RTS.state.towers.length === 0, '哨塔销毁后从列表移除');
  const tileAfter = RTS.World.worldToTile(spot.x, spot.y);
  ok(RTS.World.isWalkable(tileAfter.tx, tileAfter.ty), '哨塔销毁后地形恢复可通行');

  // ---- 4.4 分队（编队）指令：只命令指定兵种，其余兵种不受影响
  const ai = RTS.state.ai;
  ai.deepseekEverActive = true;
  ai.deepseekNextAt = Infinity;
  ai.strategy.squad = { type: 'cavalry', task: 'harass', lane: 'top' };
  const cav = RTS.Unit.create('enemy', 'cavalry', en.base.x + 100, en.base.y);
  const swordU = RTS.Unit.create('enemy', 'sword', en.base.x + 200, en.base.y);
  en.units.set(cav.id, cav);
  en.units.set(swordU.id, swordU);
  RTS.AI.updateAll(STEP); // phaseChanged=false, squadTimer=0 → 立即执行分队
  ok(cav.state === 'attackMove', '分队指令只命令骑兵编队（state=' + cav.state + '）');
  ok(swordU.state === 'idle', '非指定兵种（刀盾）不被分队命令拉走');
  // 分队类型应从普通态势执行中排除（用集结态势验证：集结只拉非骑兵）
  ai.phase = 'rally';
  ai.phaseChanged = true;
  ai.strategy.squad = { type: 'cavalry', task: 'rally', lane: null };
  RTS.AI.updateAll(STEP);
  ok(swordU.state === 'attackMove' || swordU.state === 'move', '集结态势指挥非骑兵单位（sword state=' + swordU.state + '）');
  const cavStill = cav.state;
  ok(cavStill !== 'idle', '骑兵编队仍由分队指令控制（state=' + cavStill + '，被分队派往集结点）');

  RTS.state = null;
  RTS.Maps.activate(RTS.CONFIG.defaultMap);
  console.log(pass ? '\nV9 CHECK PASSED' : '\nV9 CHECK FAILED');
  process.exit(pass ? 0 : 1);
})();
