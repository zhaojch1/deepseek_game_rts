'use strict';

/**
 * ui.js — HUD、生产面板、选中信息、toast、结束覆盖层、调试面板
 */

RTS.UI = (function () {
  let el = {};
  let toastTimer = null;

  const C = () => RTS.CONFIG;

  function init() {
    el.gold = document.getElementById('hud-gold');
    el.goldRate = document.getElementById('hud-gold-rate');
    el.wood = document.getElementById('hud-wood');
    el.woodRate = document.getElementById('hud-wood-rate');
    el.stone = document.getElementById('hud-stone');
    el.stoneRate = document.getElementById('hud-stone-rate');
    el.pop = document.getElementById('hud-pop');
    el.time = document.getElementById('hud-time');
    el.aiSource = document.getElementById('hud-ai-source');
    el.selectionPanel = document.getElementById('selection-panel');
    el.selectionTitle = document.getElementById('selection-title');
    el.selectionDetail = document.getElementById('selection-detail');
    el.queueDisplay = document.getElementById('queue-display');
    el.toasts = document.getElementById('toasts');
    el.overlay = document.getElementById('overlay');
    el.overlayTitle = document.getElementById('overlay-title');
    el.overlaySub = document.getElementById('overlay-sub');
    el.overlayRestart = document.getElementById('overlay-restart');
    el.overlayMenu = document.getElementById('overlay-menu');
    el.menu = document.getElementById('menu');
    el.mapList = document.getElementById('map-list');
    el.menuStart = document.getElementById('menu-start');
    el.debugPanel = document.getElementById('debug-panel');
    el.prodPanel = document.getElementById('production-buttons');
    el.prodButtons = [];
    el.upgButtons = Array.from(document.querySelectorAll('.upg-btn'));

    // 主菜单：地图选择（由 RTS.Maps 注册表动态生成）
    el.selectedMapId = RTS.CONFIG.defaultMap;
    buildMapList();
    el.menuStart.addEventListener('click', () => {
      RTS.Maps.activate(el.selectedMapId);
      hideMenu();
      RTS.Match.start();
    });
    el.overlayMenu.addEventListener('click', () => {
      hideOverlay();
      RTS.Match.toMenu();
      showMenu();
    });

    // 生产面板按钮由单位注册表动态生成（新增单位无需改 UI 代码）
    RTS.Units.all().forEach((def) => {
      const btn = document.createElement('button');
      btn.className = 'prod-btn';
      btn.dataset.type = def.id;
      btn.title = def.doc || def.name;
      btn.innerHTML =
        `<span class="prod-key">${def.hotkey || ''}</span>` +
        `<span class="prod-icon">${def.icon || ''}</span>` +
        `<span class="prod-name">${def.name}</span>` +
        `<span class="prod-cost">🪙${def.cost}</span>` +
        `<div class="prod-progress"><div class="prod-progress-bar"></div></div>`;
      btn.addEventListener('click', () => orderProduction(def.id));
      el.prodPanel.appendChild(btn);
      el.prodButtons.push(btn);
    });

    el.upgButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        orderUpgrade(btn.dataset.track);
      });
    });

    el.overlayRestart.addEventListener('click', () => {
      RTS.Match.restart();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        el.debugPanel.classList.toggle('hidden');
      }
    });
  }

  function orderProduction(type) {
    const st = RTS.state;
    if (st.phase !== 'running') return;
    const res = RTS.Production.order(st.player, type);
    if (!res.ok) {
      if (res.reason === 'gold') toast('军费不足', 'warn');
      else if (res.reason === 'pop') toast('部队已满', 'error');
    }
  }

  function orderUpgrade(track) {
    const st = RTS.state;
    if (st.phase !== 'running') return;
    const check = RTS.Resources.canUpgrade(st.player, track);
    if (check.reason === 'max') {
      toast('已达最高等级', 'info');
      return;
    }
    if (!check.ok) {
      const resName = RTS.CONFIG.upgrades[track].resource === 'wood' ? '木材' : '石料';
      toast(resName + '不足', 'warn');
      return;
    }
    if (RTS.Resources.upgrade(st.player, track)) {
      toast(RTS.CONFIG.upgrades[track].name + '升级完成', 'info');
    }
  }

  function toast(msg, kind) {
    const div = document.createElement('div');
    div.className = 'toast' + (kind === 'warn' ? ' warn' : kind === 'error' ? ' error' : '');
    div.textContent = msg;
    el.toasts.appendChild(div);
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 2600);
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function update(dt) {
    const st = RTS.state;
    if (!st) return;
    const player = st.player;

    el.gold.textContent = Math.floor(player.gold);
    el.goldRate.textContent = `(+${player.goldRate.toFixed(1)}/s)`;
    el.wood.textContent = Math.floor(player.wood);
    el.woodRate.textContent = `(+${player.woodRate.toFixed(1)}/s)`;
    el.stone.textContent = Math.floor(player.stone);
    el.stoneRate.textContent = `(+${player.stoneRate.toFixed(1)}/s)`;
    el.pop.textContent = player.units.size;
    el.time.textContent = fmtTime(st.time);

    // AI 来源（v4：一旦 DeepSeek 成功接管即视为 DeepSeek 驱动；未接管时为降级自动驾驶）
    if (st.ai.deepseekEverActive) {
      el.aiSource.textContent = 'AI：DeepSeek';
      el.aiSource.classList.add('deepseek');
    } else {
      el.aiSource.textContent = 'AI：降级自动驾驶';
      el.aiSource.classList.remove('deepseek');
    }

    // 生产按钮状态（按钮由注册表生成，遍历即可）
    el.prodButtons.forEach((btn) => {
      const type = btn.dataset.type;
      const s = RTS.Unit.typeStats(type);
      const costEl = btn.querySelector('.prod-cost');
      costEl.textContent = '🪙' + s.cost;
      const check = RTS.Production.canOrder(player, type);
      btn.classList.toggle('disabled', !check.ok);

      // 进度条：显示该类型首项训练进度
      const bar = btn.querySelector('.prod-progress-bar');
      const item = player.productionQueue.find((q) => q.type === type);
      if (item) {
        bar.style.width = Math.min(100, (item.elapsed / item.totalTime) * 100) + '%';
      } else {
        bar.style.width = '0%';
      }
    });

    // 升级按钮状态
    el.upgButtons.forEach((btn) => {
      const track = btn.dataset.track;
      const cfg = RTS.CONFIG.upgrades[track];
      const lvl = RTS.Resources.levelOf(player, track);
      const cost = RTS.Resources.upgradeCost(player, track);
      const levelEl = btn.querySelector('.upg-level');
      const costEl = btn.querySelector('.upg-cost');
      const descEl = btn.querySelector('.upg-desc');
      if (descEl) descEl.textContent = cfg.desc || '';
      levelEl.textContent = `${lvl}/${RTS.CONFIG.upgradeMaxLevel}`;
      if (cost === null) {
        costEl.textContent = '已满级';
        btn.classList.add('maxed');
      } else {
        const resIcon = cfg.resource === 'wood' ? '🪵' : '🪨';
        costEl.textContent = `${resIcon}${cost}`;
        btn.classList.remove('maxed');
      }
      btn.classList.toggle('disabled', !RTS.Resources.canUpgrade(player, track).ok && cost !== null);
    });

    // 队列显示
    const q = player.productionQueue;
    if (q.length === 0) {
      el.queueDisplay.textContent = '无队列';
    } else {
      const parts = q.slice(0, 6).map((item) => {
        const name = RTS.Unit.typeStats(item.type).name;
        const status = item.status === 'training' ? '训练中' : '排队';
        return `${name}(${status})`;
      });
      el.queueDisplay.textContent = parts.join(' · ') + (q.length > 6 ? '…' : '');
    }

    // 选中面板
    updateSelectionPanel(st);

    // 调试面板
    if (!el.debugPanel.classList.contains('hidden')) {
      updateDebugPanel(st);
    }
  }

  function updateSelectionPanel(st) {
    // 选中己方城堡：显示城堡信息与集结点提示
    if (st.selectedBase === 'player') {
      el.selectionPanel.classList.remove('hidden');
      const base = st.player.base;
      el.selectionTitle.textContent = '🏰 指挥所（城堡）';
      el.selectionDetail.textContent =
        `耐久 ${Math.floor(base.hp)}/${base.maxHp} · 箭塔 Lv${RTS.Resources.levelOf(st.player, 'defense')}` +
        '\n右键点击地面可设置单位出生集结点';
      return;
    }
    if (st.selection.size === 0) {
      el.selectionPanel.classList.add('hidden');
      return;
    }
    el.selectionPanel.classList.remove('hidden');
    const counts = {};
    for (const id of RTS.Units.ids()) counts[id] = 0;
    let total = 0;
    let totalHp = 0;
    let maxHp = 0;
    st.selection.forEach((id) => {
      const u = st.player.units.get(id);
      if (!u || u.hp <= 0) return;
      counts[u.type] = (counts[u.type] || 0) + 1;
      total++;
      totalHp += u.hp;
      maxHp += u.maxHp;
    });
    el.selectionTitle.textContent = `已选 ${total} 单位`;
    const names = [];
    for (const t of RTS.Units.ids()) {
      if (counts[t] > 0) names.push(`${RTS.Units.get(t).name}×${counts[t]}`);
    }
    el.selectionDetail.textContent =
      names.join('  ') + (maxHp > 0 ? `  ·  平均血量 ${Math.round((totalHp / maxHp) * 100)}%` : '');
  }

  function updateDebugPanel(st) {
    const ai = st.ai;
    const labels = RTS.AI.PHASE_LABEL || {};
    const lines = [];
    lines.push(`时间 ${fmtTime(st.time)}   FPS ${st.fps ?? 0}`);
    lines.push(`AI 来源：${ai.deepseekEverActive ? 'DeepSeek' : '降级自动驾驶'}`);
    lines.push(`AI 态势：${labels[ai.phase] || ai.phase}（${ai.phase}）`);
    lines.push(`AI 进攻倾向：${ai.strategy.aggression}`);
    if (ai.strategy.armyFocus) lines.push(`AI 兵种倾向：${RTS.Unit.typeStats(ai.strategy.armyFocus).name}`);
    if (ai.strategy.lane) lines.push(`AI 主攻方向：${ai.strategy.lane}`);
    if (ai.strategy.targetFocus) lines.push(`AI 目标侧重：${ai.strategy.targetFocus}`);
    if (ai.lastDecision) lines.push(`最近决策：${ai.lastDecision.comment || JSON.stringify(ai.lastDecision)}`);
    if (ai.lastDeepseekError) lines.push(`DeepSeek 状态：${ai.lastDeepseekError}`);
    lines.push(`DeepSeek 调用次数：${ai.deepseekCount}`);
    lines.push(`玩家资源：🪵${Math.floor(st.player.wood)} 🪨${Math.floor(st.player.stone)}`);
    const up = st.player.upgrades;
    lines.push(`玩家升级：攻${up.attack}/护${up.armor}/城防${up.defense}`);
    el.debugPanel.textContent = lines.join('\n');
  }

  function showOverlay(title, sub, kind) {
    el.overlayTitle.textContent = title;
    el.overlayTitle.className = 'overlay-title ' + kind;
    el.overlaySub.textContent = sub;
    el.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    el.overlay.classList.add('hidden');
  }

  // ---------------------------------------------------------------- 主菜单

  const SIZE_LABEL = { small: '小', medium: '中', large: '大' };

  function buildMapList() {
    el.mapList.innerHTML = '';
    RTS.Maps.all().forEach((def) => {
      const card = document.createElement('div');
      card.className = 'map-card';
      card.dataset.id = def.id;
      card.innerHTML =
        `<div class="map-card-head"><span class="map-card-name">${def.name}</span>` +
        `<span class="map-card-size">${SIZE_LABEL[def.size] || def.size || ''}</span></div>` +
        `<div class="map-card-desc">${def.doc || ''}</div>`;
      card.addEventListener('click', () => {
        el.selectedMapId = def.id;
        highlightMap();
      });
      el.mapList.appendChild(card);
    });
    highlightMap();
  }

  function highlightMap() {
    el.mapList.querySelectorAll('.map-card').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === el.selectedMapId);
    });
  }

  function showMenu() {
    el.menu.classList.remove('hidden');
    buildMapList();
  }

  function hideMenu() {
    el.menu.classList.add('hidden');
  }

  return { init, update, orderProduction, toast, showOverlay, hideOverlay, showMenu, hideMenu };
})();
