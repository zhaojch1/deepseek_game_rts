'use strict';

/**
 * main.js — 入口、游戏主循环、对局状态、胜负判定
 */

RTS.Match = (function () {
  const C = () => RTS.CONFIG;

  function createState() {
    RTS.world = RTS.World.create();
    const bases = RTS.World.placeBases();
    const Cfg = C();

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
      upgrades: { attack: 0, armor: 0, defense: 0 },
    });

    const state = {
      time: 0,
      phase: 'running', // running | victory | defeat | draw
      fps: 0,
      debugMode: true,
      player: mkFaction('player', bases.player),
      enemy: mkFaction('enemy', bases.enemy),
      selection: new Set(),
      damageNumbers: [],
      resources: { nodes: RTS.World.placeResources() },
      corpses: [],
      ai: RTS.AI.init(),
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
    RTS.state = createState();
    RTS.UI.hideOverlay();
    RTS.Camera.setCenter(RTS.state.player.base.x, RTS.state.player.base.y);
  }

  function start() {
    RTS.state = createState();
    RTS.UI.hideOverlay();
    RTS.Camera.init();
    RTS.UI.toast('派部队占领金/木/石资源点，占领后持续产出', 'info');
  }

  return { start, restart, checkEnd, createState, updateAllUnits };
})();

// ---------------------------------------------------------------- 启动

(function boot() {
  const canvas = document.getElementById('game-canvas');
  const minimap = document.getElementById('minimap');

  RTS.UI.init();
  RTS.Match.start();
  RTS.Render.init(canvas, minimap);
  RTS.Input.init(canvas);

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
        RTS.AI.update(STEP);
        RTS.Combat.rebuildHash();
        RTS.Resources.captureUpdate(STEP);
        RTS.Resources.incomeUpdate(STEP);
        RTS.Resources.baseDefenseUpdate(STEP);
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

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
