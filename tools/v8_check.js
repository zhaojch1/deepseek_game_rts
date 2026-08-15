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
  'public/js/maps/valley_river.js', 'public/js/maps/wide_river.js', 'public/js/maps/grand_basin.js',
  'public/js/world.js', 'public/js/pathfinding.js', 'public/js/camera.js',
  'public/js/unit.js', 'public/js/combat.js', 'public/js/production.js',
  'public/js/resources.js', 'public/js/projectiles.js', 'public/js/ai.js',
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
  ok(ids.length === 8, '注册表共 8 个兵种 = ' + ids.join(','));
  for (const id of ['hammer', 'horse_archer', 'wall']) ok(RTS.Units.has(id), '新兵种已注册: ' + id);
  const h = RTS.Units.get('hammer');
  ok(h.bonusVs.wall === 1.4, '锤子兵克制肉盾 ×1.4');
  ok(h.bonusVs.sword === 1.4, '锤子兵克制刀盾 ×1.4');
  ok(h.baseMul === 1.5, '锤子兵攻城对基地 ×1.5');
  const ha = RTS.Units.get('horse_archer');
  ok(ha.ranged && ha.speed === 3.8, '骑射手为远程且高速');
  ok(ha.bonusVs.hammer === 1.3, '骑射手克制锤子兵 ×1.3');
  const w = RTS.Units.get('wall');
  ok(w.hp === 320 && w.bonusVs.cavalry === 1.3, '肉盾高生命且克骑兵 ×1.3');

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
  console.log(pass ? '\nV8 CHECK PASSED' : '\nV8 CHECK FAILED');
  process.exit(pass ? 0 : 1);
})();
