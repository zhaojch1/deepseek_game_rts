'use strict';

/**
 * v7.1 AI 控制「来回横跳」回归测试：
 * 验证两点——
 *  A. 执行器层：单位在前往金矿途中，LLM 换成占木场/集结等普通态势时，在途单位不得被重新下令；
 *     只有紧急态势（撤退/防守）才会强制召回在途单位。
 *  B. 决策层：态势切换冷却——非紧急态势在 aiStanceHoldTime 内不重复翻转；
 *     紧急防守态势不受冷却限制，立即生效。
 * 运行：node tools/ai_commit_test.js
 */

const fs = require('fs');
const vm = require('vm');

global.window = global;
global.RTS = global.RTS || {};
global.RTS.UI = { toast: () => {}, aiMessage: () => {} };

let decisionSeq = 0;
global.fetch = async () => {
  decisionSeq++;
  const stance = decisionSeq === 1 ? 'capture_gold' : decisionSeq === 2 ? 'capture_wood' : decisionSeq === 3 ? 'capture_gold' : 'defend';
  return {
    json: async () => ({
      ok: true,
      source: 'deepseek',
      decision: { armyFocus: 'sword', aggression: 50, stance, lane: 'mid', targetFocus: 'army', attackNow: false, comment: '测试' + stance },
    }),
  };
};

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

(async () => {
  const map = RTS.Maps.get('valley_river');
  RTS.Maps.activate('valley_river');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);
  const mkFaction = (owner, base) => ({
    owner, gold: 500, goldRate: 5, wood: 0, woodRate: 0, stone: 0, stoneRate: 0,
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
    playerAI: RTS.AI.init('player', 'deepseek'),
  };
  // 关闭 LLM 请求与降级自动驾驶，专注测试执行器
  for (const ai of [RTS.state.ai, RTS.state.playerAI]) {
    ai.deepseekEverActive = true;
    ai.deepseekNextAt = Infinity;
  }

  let pass = true;
  const playerAI = RTS.state.playerAI;
  const goldNode = RTS.state.resources.nodes.find((n) => n.type === 'gold');
  const base = RTS.state.player.base;

  // ---- A. 执行器：在途单位不被普通态势改命 ----
  const units = [];
  for (let i = 0; i < 4; i++) {
    const u = RTS.Unit.create('player', 'sword', base.x + 60 + i * 40, base.y);
    RTS.state.player.units.set(u.id, u);
    RTS.Unit.orderAttackMove(u, goldNode.x, goldNode.y);
    units.push(u);
  }
  const goldTargets = units.map((u) => ({ ...u.orderTarget }));
  console.log('A: 4 个单位已出发前往金矿 (', Math.round(goldNode.x), Math.round(goldNode.y), ')');

  // 手动切态势时同步置 phaseChanged，模拟一次真实态势变更（触发执行器）
  const switchPhase = (ai, ph) => {
    ai.phase = ph;
    ai.phaseChanged = true;
  };

  switchPhase(playerAI, 'capture_gold');
  RTS.AI.updateAll(1 / 60);
  const afterGold = units.map((u) => ({ ...u.orderTarget }));
  const goldSame = afterGold.every((t, i) => t.x === goldTargets[i].x && t.y === goldTargets[i].y);
  console.log('A: 态势=占金矿 后，在途单位目标不变 =', goldSame);
  if (!goldSame) pass = false;

  switchPhase(playerAI, 'capture_wood');
  RTS.AI.updateAll(1 / 60);
  const afterWood = units.map((u) => ({ ...u.orderTarget }));
  const woodSame = afterWood.every((t, i) => t.x === goldTargets[i].x && t.y === goldTargets[i].y);
  console.log('A: 态势换成占木场 后，在途单位仍保持原目标 =', woodSame, '（不回拽）');
  if (!woodSame) pass = false;

  switchPhase(playerAI, 'rally');
  RTS.AI.updateAll(1 / 60);
  const afterRally = units.map((u) => ({ ...u.orderTarget }));
  const rallySame = afterRally.every((t, i) => t.x === goldTargets[i].x && t.y === goldTargets[i].y);
  console.log('A: 态势换成集结 后，在途单位仍保持原目标 =', rallySame, '（不回拽）');
  if (!rallySame) pass = false;

  // 紧急态势：撤退 → 强制召回在途单位
  switchPhase(playerAI, 'retreat');
  RTS.AI.updateAll(1 / 60);
  const afterRetreat = units.map((u) => ({ ...u.orderTarget }));
  const recalled = afterRetreat.every((t) =>
    Math.hypot(t.x - base.x, t.y - base.y) < Math.hypot(goldNode.x - base.x, goldNode.y - base.y)
  );
  console.log('A: 态势换成撤退 后，在途单位被召回基地附近 =', recalled);
  if (!recalled) pass = false;

  // 空闲单位应能被普通态势重新下令（新刷出的空闲单位加入占金矿行动）
  switchPhase(playerAI, 'capture_gold');
  const fresh = RTS.Unit.create('player', 'sword', base.x + 30, base.y); // idle
  RTS.state.player.units.set(fresh.id, fresh);
  RTS.AI.updateAll(1 / 60);
  const freshAssigned = fresh.state === 'attackMove' && Math.abs(fresh.orderTarget.x - (base.x + 30)) > 1;
  console.log('A: 空闲单位被派往金矿 =', freshAssigned, '(state=' + fresh.state + ')');
  if (!freshAssigned) pass = false;

  // ---- B. 决策层：态势切换冷却 ----
  // 重新启用 LLM（deepseekNextAt=0），fetch 按序返回 capture_gold → capture_wood → capture_gold → defend
  const ai2 = RTS.state.ai; // 用敌方 AI 测冷却
  ai2.deepseekEverActive = false;
  ai2.deepseekNextAt = 0;
  ai2.phase = 'build';
  ai2.lastStanceChangeTime = -9999;
  decisionSeq = 0;
  const phaseLog = [];
  const STEP = 1 / 60;
  let lastLogTime = 0;
  for (let i = 0; i < 60 * 60 * 1; i++) { // 1 分钟
    RTS.state.time += STEP;
    RTS.AI.updateAll(STEP);
    if (i % (3 * 60) === 0) await new Promise((r) => setTimeout(r, 0)); // 刷 fetch 微任务
    if (RTS.state.time - lastLogTime >= 2) {
      phaseLog.push(Math.round(RTS.state.time) + 's:' + ai2.phase);
      lastLogTime = RTS.state.time;
    }
  }
  await new Promise((r) => setTimeout(r, 10));
  // 期望：capture_gold 生效后，capture_wood 被冷却挡住；defend（紧急）立即生效
  const sawWood = phaseLog.some((p) => p.includes('capture_wood'));
  const sawDefend = phaseLog.some((p) => p.includes('defend'));
  console.log('B: 态势时间线（2s 采样）:', phaseLog.join(' '));
  console.log('B: capture_wood 被冷却拦截 =', !sawWood, ' defend 紧急生效 =', sawDefend);
  if (sawWood) pass = false;
  if (!sawDefend) pass = false;

  console.log(pass ? 'AI COMMIT TEST PASSED' : 'AI COMMIT TEST FAILED');
  process.exit(pass ? 0 : 1);
})();
