'use strict';

/**
 * main.js — 入口、游戏主循环、对局状态、胜负判定
 */

RTS.Match = (function () {
  const C = () => RTS.CONFIG;

  function createState(providers) {
    const map = RTS.Maps.current();
    RTS.world = RTS.World.create(map);
    const bases = RTS.World.placeBases(map);
    const Cfg = C();
    const p = providers || { player: 'deepseek', enemy: 'deepseek' };

    const mkFaction = (owner, base) => ({
      owner,
      gold: Cfg.initialGold,
      goldRate: Cfg.baseGoldRate,
      wood: 0,
      woodRate: 0,
      stone: 0,
      stoneRate: 0,
      populationCap: Cfg.populationCap,
      base,
      productionQueue: [],
      units: new Map(),
      upgrades: { attack: 0, armor: 0, defense: 0, siegecraft: 0, mobility: 0 },
    });

    const state = {
      time: 0,
      phase: 'running', // running | victory | defeat | draw
      fps: 0,
      debugMode: true,
      player: mkFaction('player', bases.player),
      enemy: mkFaction('enemy', bases.enemy),
      selection: new Set(),
      selectedBase: null, // 'player' 表示已选中己方城堡（用于设置集结点）
      damageNumbers: [],
      resources: { nodes: RTS.World.placeResources(map) },
      corpses: [],
      towers: [], // v9：防御哨塔列表（建筑师建造）
      ai: RTS.AI.init('enemy', p.enemy),   // 敌方 AI（LLM 接管）
      playerAI: null,                       // 玩家 AI 接管实例（顶部按钮创建，null 表示未接管）
    };
    RTS.Projectiles.clear();
    return state;
  }

  function updateAllUnits(dt) {
    const st = RTS.state;
    st.player.units.forEach((u) => RTS.Unit.update(u, dt));
    st.enemy.units.forEach((u) => RTS.Unit.update(u, dt));
  }

  function checkEnd() {
    const st = RTS.state;
    if (st.phase !== 'running') return;

    const playerBase = st.player.base;
    const enemyBase = st.enemy.base;

    if (enemyBase.hp <= 0) {
      end('victory');
    } else if (playerBase.hp <= 0) {
      end('defeat');
    } else if (st.time >= C().maxMatchSeconds) {
      // 20 分钟封顶：按剩余兵力 + 基地耐久判胜
      const playerScore = st.player.units.size * 10 + playerBase.hp;
      const enemyScore = st.enemy.units.size * 10 + enemyBase.hp;
      if (playerScore > enemyScore) end('victory');
      else if (enemyScore > playerScore) end('defeat');
      else end('draw');
    }
  }

  function end(result) {
    const st = RTS.state;
    st.phase = result;
    const mins = Math.floor(st.time / 60);
    const secs = Math.floor(st.time % 60);
    const timeStr = `${mins}分${secs}秒`;

    if (result === 'victory') {
      RTS.UI.showOverlay('胜利', `摧毁敌方指挥所！用时 ${timeStr}`, 'victory');
    } else if (result === 'defeat') {
      RTS.UI.showOverlay('失败', `我方指挥所被摧毁。用时 ${timeStr}`, 'defeat');
    } else {
      RTS.UI.showOverlay('平局', `双方势均力敌。用时 ${timeStr}`, 'draw');
    }
  }

  function restart() {
    const providers = RTS.UI.getSelectedAIProviders ? RTS.UI.getSelectedAIProviders() : { player: 'deepseek', enemy: 'deepseek' };
    RTS.state = createState(providers);
    applyStartTakeover(providers);
    RTS.UI.hideOverlay();
    if (RTS.UI.clearAIMessages) RTS.UI.clearAIMessages();
    RTS.Camera.setCenter(RTS.state.player.base.x, RTS.state.player.base.y);
  }

  function start() {
    const providers = RTS.UI.getSelectedAIProviders ? RTS.UI.getSelectedAIProviders() : { player: 'deepseek', enemy: 'deepseek' };
    RTS.state = createState(providers);
    applyStartTakeover(providers);
    RTS.UI.hideOverlay();
    if (RTS.UI.clearAIMessages) RTS.UI.clearAIMessages();
    RTS.Camera.init();
    RTS.UI.toast('派部队占领金/木/石资源点，占领后持续产出', 'info');
  }

  /** v7.1：主菜单勾选「开局即由 AI 接管」时，开局立刻创建玩家 AI 实例 */
  function applyStartTakeover(providers) {
    if (RTS.UI.getAITakeoverAtStart && RTS.UI.getAITakeoverAtStart()) {
      RTS.state.playerAI = RTS.AI.init('player', providers.player);
      RTS.UI.toast('开局即由 AI 接管玩家部队', 'info');
    }
  }

  /** 返回主菜单：清除对局状态（主循环见 state 为空则只渲染菜单） */
  function toMenu() {
    RTS.state = null;
    RTS.Projectiles.clear();
  }

  return { start, restart, toMenu, checkEnd, createState, updateAllUnits };
})();

// ---------------------------------------------------------------- 启动

(function boot() {
  const canvas = document.getElementById('game-canvas');
  const minimap = document.getElementById('minimap');

  RTS.Maps.activate(RTS.CONFIG.defaultMap);
  RTS.UI.init(); // 构建主菜单（地图选择）+ 各面板
  RTS.Render.init(canvas, minimap);
  RTS.Input.init(canvas);
  // 不自动开战：等待玩家在主菜单选择地图后点击「开始游戏」

  window.addEventListener('resize', () => {
    RTS.Render.resize();
    RTS.Camera.resize();
    RTS.Camera.clamp();
  });

  // 主循环：固定步长模拟 + 实时渲染
  const STEP = 1 / 60;
  let last = performance.now();
  let acc = 0;
  let fpsFrames = 0;
  let fpsTime = 0;

  function frame(now) {
    const rawDt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (RTS.state) {
      // FPS 统计
      fpsFrames++;
      fpsTime += rawDt;
      if (fpsTime >= 0.5) {
        RTS.state.fps = Math.round(fpsFrames / fpsTime);
        fpsFrames = 0;
        fpsTime = 0;
      }

      acc += rawDt;
      while (acc >= STEP) {
        if (RTS.state.phase === 'running') {
          RTS.state.time += STEP;
          RTS.Production.update(STEP);
          RTS.AI.updateAll(STEP);
          RTS.Combat.rebuildHash();
          RTS.Resources.captureUpdate(STEP);
          RTS.Resources.incomeUpdate(STEP);
          RTS.Resources.baseDefenseUpdate(STEP);
          // v9：防御哨塔——推进建筑师施工 + 哨塔自动射箭
          RTS.Towers.updateArchitects(STEP);
          RTS.Towers.update(STEP);
          RTS.Match.updateAllUnits(STEP);
          RTS.Projectiles.update(STEP);
          RTS.Combat.applySeparation();
          RTS.Combat.ageDamageNumbers(STEP);
          RTS.Combat.ageCorpses(STEP);
          RTS.Match.checkEnd();
        }
        acc -= STEP;
      }

      RTS.Input.update(rawDt);
      RTS.UI.update(rawDt);
      RTS.Render.draw();
      RTS.Render.drawMinimap();
    } else {
      // 主菜单阶段：清空画布（菜单为 DOM 覆盖层）
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
