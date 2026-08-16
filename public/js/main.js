'use strict';

/**
 * main.js — 入口、游戏主循环、对局状态、胜负判定
 */

RTS.Match = (function () {
  const C = () => RTS.CONFIG;

  function createState(providers) {
    const map = RTS.Maps.current();
    RTS.world = RTS.World.create(map);
    const bases = RTS.World.placeBases(map); // v11：{ player: [base...], enemy: [base...] }
    const Cfg = C();
    const p = providers || { player: 'deepseek', enemy: 'deepseek' };

    const mkFaction = (owner, baseList) => ({
      owner,
      gold: Cfg.initialGold,
      goldRate: Cfg.baseGoldRate,
      wood: 0,
      woodRate: 0,
      stone: 0,
      stoneRate: 0,
      populationCap: Cfg.populationCap,
      base: baseList[0], // v11：主基地（bases[0]，通常是中路基地），兼容旧代码
      bases: baseList,   // v11：该阵营全部基地
      spawnBaseIdx: 0,   // v11：出兵基地轮转指针（中→上→下）
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
      selectedBase: null, // v11：已选中的己方基地对象（用于设置集结点）
      damageNumbers: [],
      resources: { nodes: RTS.World.placeResources(map) },
      corpses: [],
      towers: [], // v9：防御哨塔列表（建筑师建造）
      barracks: [], // v10.2：兵营列表（建筑师建造，第二出兵点）
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

    // v11：多基地——任一方全部基地被摧毁即判负（需逐个击破所有指挥所）
    const playerAlive = st.player.bases.some((b) => b.hp > 0);
    const enemyAlive = st.enemy.bases.some((b) => b.hp > 0);

    if (!enemyAlive) {
      end('victory');
    } else if (!playerAlive) {
      end('defeat');
    } else if (st.time >= C().maxMatchSeconds) {
      // 20 分钟封顶：按剩余兵力 + 全部基地耐久判胜
      const sumHp = (list) => list.reduce((s, b) => s + b.hp, 0);
      const playerScore = st.player.units.size * 10 + sumHp(st.player.bases);
      const enemyScore = st.enemy.units.size * 10 + sumHp(st.enemy.bases);
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
      RTS.UI.showOverlay('胜利', `摧毁敌方全部指挥所！用时 ${timeStr}`, 'victory');
    } else if (result === 'defeat') {
      RTS.UI.showOverlay('失败', `我方全部指挥所被摧毁。用时 ${timeStr}`, 'defeat');
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
          // v12：编队系统——清空角色缓存（每帧重建）
          if (RTS.Formations) RTS.Formations.clearCache();
          RTS.Production.update(STEP);
          RTS.AI.updateAll(STEP);
          // v12：编队速度同步——让前队减速等后队（在 rebuildHash 之前，单位 update 之前）
          if (RTS.Formations) RTS.Formations.syncFormationSpeed();
          RTS.Combat.rebuildHash();
          RTS.Resources.captureUpdate(STEP);
          RTS.Resources.incomeUpdate(STEP);
          RTS.Resources.baseDefenseUpdate(STEP);
          // v9：防御哨塔——推进建筑师施工 + 哨塔自动射箭
          RTS.Towers.updateArchitects(STEP);
          RTS.Towers.update(STEP);
          // v10.2：兵营——推进建筑师施工（兵营无自动攻击）
          RTS.Barracks.updateBuilders(STEP);
          // v11.1：基地修复——推进建筑师修复被摧毁的基地
          RTS.Bases.updateRepairers(STEP);
          RTS.Match.updateAllUnits(STEP);
          RTS.Projectiles.update(STEP);
          RTS.Combat.applySeparation();
          // v12：编队增强分离（跨角色额外间距，防止兵种堆叠）
          if (RTS.Formations) RTS.Formations.applyFormationSeparation();
          // v12：编队凝聚力——空闲单位自动向理想位置漂移（排好阵型）
          if (RTS.Formations) RTS.Formations.applyCohesion();
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
