'use strict';

/**
 * v7 无头冒烟测试：按 README §6 顺序加载模块，
 * 同时创建敌方 AI（deepseek）与玩家 AI 接管实例（doubao），
 * 模拟 2 分钟对局，验证：
 *   1. 两个 AI 实例都能正常驱动各自阵营（生产/决策/指令）
 *   2. 单位确实被生产出来
 *   3. 双方 AI 都收到大模型决策
 * 运行：node tools/smoke_v7.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;

// 在 ai.js 之前 stub UI（applyDecision 的 aiMessage / toast 依赖）
global.RTS = global.RTS || {};
global.RTS.UI = {
  toast: () => {},
  aiMessage: (side, text) => {
    if (global.__aiMsgs) global.__aiMsgs.push(side + ':' + text);
  },
};
global.__aiMsgs = [];

let fetchCount = 0;
const STANCES = ['capture_gold', 'rally', 'assault_mid', 'defend', 'scout'];
global.fetch = async () => {
  fetchCount++;
  const stance = STANCES[fetchCount % STANCES.length];
  return {
    json: async () => ({
      ok: true,
      source: 'deepseek',
      decision: {
        armyFocus: 'sword',
        aggression: 70,
        stance,
        lane: 'mid',
        targetFocus: stance === 'assault_mid' ? 'base' : 'army',
        attackNow: false,
        comment: 'smoke 测试决策 ' + stance,
      },
    }),
  };
};

const files = [
  'public/js/config.js',
  'public/js/registry.js',
  'public/js/units/spear.js',
  'public/js/units/sword.js',
  'public/js/units/archer.js',
  'public/js/units/crossbow.js',
  'public/js/units/cavalry.js',
  'public/js/maps/valley_river.js',
  'public/js/maps/wide_river.js',
  'public/js/world.js',
  'public/js/pathfinding.js',
  'public/js/camera.js',
  'public/js/unit.js',
  'public/js/combat.js',
  'public/js/production.js',
  'public/js/resources.js',
  'public/js/projectiles.js',
  'public/js/ai.js',
];

for (const f of files) {
  vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}

(async () => {
  const map = RTS.Maps.get('valley_river');
  RTS.Maps.activate('valley_river');
  RTS.world = RTS.World.create(map);
  const bases = RTS.World.placeBases(map);

  const mkFaction = (owner, base) => ({
    owner, gold: 300, goldRate: 5, wood: 0, woodRate: 0, stone: 0, stoneRate: 0,
    populationCap: 100, base, productionQueue: [], units: new Map(),
    upgrades: { attack: 0, armor: 0, defense: 0 },
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
    playerAI: RTS.AI.init('player', 'doubao'),
  };

  const STEP = 1 / 60;
  let combatActivity = { playerAttack: false, enemyAttack: false, maxPlayerUnits: 0 };
  for (let i = 0; i < 60 * 60 * 2; i++) { // 模拟 2 分钟
    RTS.state.time += STEP;
    RTS.Production.update(STEP);
    RTS.AI.updateAll(STEP);
    RTS.Combat.rebuildHash();
    RTS.Resources.captureUpdate(STEP);
    RTS.Resources.incomeUpdate(STEP);
    RTS.Resources.baseDefenseUpdate(STEP);
    RTS.state.player.units.forEach((u) => RTS.Unit.update(u, STEP));
    RTS.state.enemy.units.forEach((u) => RTS.Unit.update(u, STEP));
    RTS.Projectiles.update(STEP);
    RTS.Combat.applySeparation();
    RTS.Combat.ageDamageNumbers(STEP);
    RTS.Combat.ageCorpses(STEP);
    // 每 5 秒采样一次战斗活动（是否有单位进入攻击状态）
    if (i % (5 * 60) === 0) {
      for (const u of RTS.state.player.units.values()) if (u.state === 'attack') combatActivity.playerAttack = true;
      for (const u of RTS.state.enemy.units.values()) if (u.state === 'attack') combatActivity.enemyAttack = true;
      combatActivity.maxPlayerUnits = Math.max(combatActivity.maxPlayerUnits, RTS.state.player.units.size);
    }
    // 周期性让 fetch 微任务落定，使 AI 在模拟过程中能连续刷新决策
    if (i % (2 * 60) === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // 让 fetch 微任务落定（决策被应用）
  await new Promise((r) => setTimeout(r, 20));

  const playerUnits = RTS.state.player.units.size;
  const enemyUnits = RTS.state.enemy.units.size;
  console.log('模拟时间:', Math.round(RTS.state.time), 's');
  console.log('玩家单位:', playerUnits, ' 敌方单位:', enemyUnits);
  console.log('敌方 AI: phase=' + RTS.state.ai.phase,
    ' everActive=' + RTS.state.ai.deepseekEverActive,
    ' count=' + RTS.state.ai.deepseekCount);
  console.log('玩家 AI: phase=' + RTS.state.playerAI.phase,
    ' everActive=' + RTS.state.playerAI.deepseekEverActive,
    ' count=' + RTS.state.playerAI.deepseekCount);
  console.log('fetch 调用次数:', fetchCount);
  console.log('AI 消息条数:', global.__aiMsgs.length, '示例:', global.__aiMsgs.slice(0, 2));
  console.log('战斗活动: 玩家方攻击过=' + combatActivity.playerAttack,
    ' 敌对方攻击过=' + combatActivity.enemyAttack,
    ' 玩家最大兵力=' + combatActivity.maxPlayerUnits);

  let pass = true;
  if (playerUnits === 0 || enemyUnits === 0) {
    console.log('FAIL: 双方都应有单位产出');
    pass = false;
  }
  if (RTS.state.ai.deepseekCount === 0 || RTS.state.playerAI.deepseekCount === 0) {
    console.log('FAIL: 双方 AI 都应发起大模型决策');
    pass = false;
  }
  if (!RTS.state.ai.deepseekEverActive || !RTS.state.playerAI.deepseekEverActive) {
    console.log('FAIL: 双方 AI 都应成功接管');
    pass = false;
  }
  if (global.__aiMsgs.length === 0) {
    console.log('FAIL: AI 决策消息应写入 aiMessage 通道');
    pass = false;
  }
  if (!combatActivity.enemyAttack) {
    console.log('WARN: 采样窗口内未观察到敌方单位进入攻击状态（可能 2 分钟太短）');
  }
  console.log(pass ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
  process.exit(pass ? 0 : 1);
})();
