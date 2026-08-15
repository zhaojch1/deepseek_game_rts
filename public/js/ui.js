'use strict';

/**
 * ui.js — HUD、生产面板、选中信息、toast、结束覆盖层、调试面板
 */

RTS.UI = (function () {
  let el = {};
  let toastTimer = null;

  const C = () => RTS.CONFIG;

  // 生产按钮按键盘顺序排列（QWERTY 第一行…）：Q/W/E/R/T/Y/U/I → 长矛/刀盾/弓箭/骑兵/弩手/锤子/骑射/肉盾
  const HOTKEY_RANK = 'QWERTYUIOPASDFGHJKLZXCVBNM1234567890';
  function hotkeyRank(def) {
    const h = (def.hotkey || '').toUpperCase();
    const i = HOTKEY_RANK.indexOf(h);
    return i === -1 ? 999 : i;
  }

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
    el.aiTakeover = document.getElementById('hud-ai-takeover');
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
    el.playerAIProvider = document.getElementById('ai-provider-player');
    el.enemyAIProvider = document.getElementById('ai-provider-enemy');
    el.menuAITakeover = document.getElementById('menu-ai-takeover');
    el.aiMsgPlayer = document.getElementById('ai-msg-player');
    el.aiMsgEnemy = document.getElementById('ai-msg-enemy');

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

    // 顶部「AI 接管」按钮：把玩家部队指挥权交给 AI（再点一次交还）
    el.aiTakeover.addEventListener('click', togglePlayerAI);

    // 生产面板按钮由单位注册表动态生成（按热键键盘顺序排列，新增单位无需改 UI 代码）
    RTS.Units.all()
      .slice()
      .sort((a, b) => hotkeyRank(a) - hotkeyRank(b))
      .forEach((def) => {
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

  /** 读取主菜单中选定的双方 AI 大模型 */
  function getSelectedAIProviders() {
    return {
      player: el.playerAIProvider ? el.playerAIProvider.value : 'deepseek',
      enemy: el.enemyAIProvider ? el.enemyAIProvider.value : 'deepseek',
    };
  }

  /** 主菜单「开局即由 AI 接管玩家部队」是否勾选 */
  function getAITakeoverAtStart() {
    return !!(el.menuAITakeover && el.menuAITakeover.checked);
  }

  /**
   * v7.1：AI 决策消息常驻提示条（玩家左蓝 / 敌方右红）。
   * 消息不会自动消失；每侧最多保留 5 条，超过后最老的一条慢慢淡出。
   */
  function aiMessage(side, text) {
    const box = side === 'player' ? el.aiMsgPlayer : el.aiMsgEnemy;
    if (!box) return;
    const item = document.createElement('div');
    item.className = 'ai-msg ' + side;
    const head = document.createElement('div');
    head.className = 'ai-msg-head';
    head.textContent = '🤖 ' + (side === 'player' ? '玩家 AI' : '敌方 AI');
    const body = document.createElement('div');
    body.className = 'ai-msg-body';
    body.textContent = text || '';
    item.appendChild(head);
    item.appendChild(body);
    box.appendChild(item);
    // 超过 5 条：把最老的「未在淡出」消息标记为淡出，淡出动画结束后再移除。
    // 注意一次只淡出一条，且不能同步移除（否则动画失效）；淡出中的消息不再重复标记。
    if (box.children.length > 5) {
      let oldest = box.firstElementChild;
      while (oldest && oldest.classList.contains('fading')) oldest = oldest.nextElementSibling;
      if (oldest) {
        oldest.classList.add('fading');
        const remove = () => {
          if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
        };
        oldest.addEventListener('transitionend', remove, { once: true });
        // 兜底：万一 transitionend 未触发（极少见），2s 后强制移除
        setTimeout(remove, 2200);
      }
    }
  }

  /** 开局/重开时清空两侧 AI 消息 */
  function clearAIMessages() {
    if (el.aiMsgPlayer) el.aiMsgPlayer.innerHTML = '';
    if (el.aiMsgEnemy) el.aiMsgEnemy.innerHTML = '';
  }

  /** 顶部按钮：玩家部队交给 AI 接管（可再点一次交还） */
  function togglePlayerAI() {
    const st = RTS.state;
    if (!st || st.phase !== 'running') return;
    if (st.playerAI) {
      st.playerAI = null;
      toast('已交还玩家控制', 'info');
    } else {
      st.playerAI = RTS.AI.init('player', getSelectedAIProviders().player);
      toast('玩家部队已交由 AI 指挥', 'info');
    }
  }

  function playerAIControlled() {
    const st = RTS.state;
    return !!(st && st.playerAI);
  }

  function orderProduction(type) {
    const st = RTS.state;
    if (st.phase !== 'running') return;
    if (playerAIControlled()) {
      toast('AI 指挥中，无法手动出兵', 'warn');
      return;
    }
    const res = RTS.Production.order(st.player, type);
    if (!res.ok) {
      if (res.reason === 'gold') toast('军费不足', 'warn');
      else if (res.reason === 'pop') toast('部队已满', 'error');
    }
  }

  function orderUpgrade(track) {
    const st = RTS.state;
    if (st.phase !== 'running') return;
    if (playerAIControlled()) {
      toast('AI 指挥中，无法手动升级', 'warn');
      return;
    }
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

    // AI 来源（一旦大模型成功接管即视为大模型驱动；未接管时为降级自动驾驶）
    if (st.ai.deepseekEverActive) {
      el.aiSource.textContent = 'AI：' + (st.ai.provider === 'doubao' ? '豆包' : 'DeepSeek');
      el.aiSource.classList.add('deepseek');
    } else {
      el.aiSource.textContent = 'AI：降级自动驾驶';
      el.aiSource.classList.remove('deepseek');
    }

    // AI 接管按钮状态
    if (st.playerAI) {
      el.aiTakeover.textContent = '✋ 交还控制';
      el.aiTakeover.classList.add('active');
    } else {
      el.aiTakeover.textContent = '🤖 AI接管';
      el.aiTakeover.classList.remove('active');
    }

    // 生产按钮状态（按钮由注册表生成，遍历即可；AI 接管时全部禁用）
    el.prodButtons.forEach((btn) => {
      const type = btn.dataset.type;
      const s = RTS.Unit.typeStats(type);
      const costEl = btn.querySelector('.prod-cost');
      costEl.textContent = '🪙' + s.cost;
      const check = RTS.Production.canOrder(player, type);
      btn.classList.toggle('disabled', !check.ok || !!st.playerAI);

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
      if (st.playerAI) btn.classList.add('disabled');
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
    let detail = names.join('  ') + (maxHp > 0 ? `  ·  平均血量 ${Math.round((totalHp / maxHp) * 100)}%` : '');
    // v9：选中建筑师时提示建造操作
    if (counts.architect > 0) {
      const Cfg = RTS.CONFIG;
      detail += `\n👷 建筑师×${counts.architect}：按 B + 左键建造防御哨塔（🪵${Cfg.towerBuildCost.wood} 🪨${Cfg.towerBuildCost.stone}）` +
        `，按 N + 左键建造兵营（🪵${Cfg.barracksBuildCost.wood} 🪨${Cfg.barracksBuildCost.stone}）`;
    }
    el.selectionDetail.textContent = detail;
  }

  function aiSourceLabel(ai) {
    if (!ai) return '—';
    return ai.deepseekEverActive
      ? (ai.provider === 'doubao' ? '豆包' : 'DeepSeek')
      : '降级自动驾驶';
  }

  function updateDebugPanel(st) {
    const labels = RTS.AI.PHASE_LABEL || {};
    const ai = st.ai;
    const lines = [];
    lines.push(`时间 ${fmtTime(st.time)}   FPS ${st.fps ?? 0}`);
    lines.push(`敌方 AI：${aiSourceLabel(ai)}（${labels[ai.phase] || ai.phase}）`);
    if (st.playerAI) {
      lines.push(`玩家 AI：${aiSourceLabel(st.playerAI)}（${labels[st.playerAI.phase] || st.playerAI.phase}）`);
    }
    lines.push(`敌方进攻倾向：${ai.strategy.aggression}`);
    if (ai.strategy.armyFocus) lines.push(`敌方兵种倾向：${RTS.Unit.typeStats(ai.strategy.armyFocus).name}`);
    if (ai.strategy.lane) lines.push(`敌方主攻方向：${ai.strategy.lane}`);
    if (ai.strategy.targetFocus) lines.push(`敌方目标侧重：${ai.strategy.targetFocus}`);
    if (ai.strategy.squad && RTS.Units.get(ai.strategy.squad.type)) {
      const sq = ai.strategy.squad;
      lines.push(`敌方分队：${RTS.Units.get(sq.type).name} → ${sq.task}${sq.lane ? ' (' + sq.lane + ')' : ''}`);
    }
    // v10：指挥链状态
    lines.push(`[主将] 指令·攻：${(ai.strategy.offenseDirective || '—').slice(0, 24)}`);
    lines.push(`[主将] 指令·守：${(ai.strategy.defenseDirective || '—').slice(0, 24)}`);
    lines.push(`[主将] 指令·经：${(ai.strategy.economyDirective || '—').slice(0, 24)}`);
    lines.push(`[进攻副将] ${ai.offenseActive ? '已接管' : '未启动'} 命令${ai.offenseOrders.length}条` +
      (ai.offenseError ? ` 错误:${ai.offenseError}` : '') + ` 调用${ai.offenseCount}次`);
    lines.push(`[防守副将] ${ai.defenseActive ? '已接管' : '未启动'} 命令${ai.defenseOrders.length}条` +
      (ai.defenseError ? ` 错误:${ai.defenseError}` : '') + ` 调用${ai.defenseCount}次`);
    lines.push(`[军需官] ${ai.qmActive ? '已接管' : '未启动'}` +
      (ai.qmError ? ` 错误:${ai.qmError}` : '') + ` 调用${ai.qmCount}次`);
    if (ai.qm && ai.qm.plan && ai.qm.plan.length > 0) {
      lines.push(`[军需官] 生产计划：${ai.qm.plan.map((p) => (RTS.Units.get(p.type) ? RTS.Units.get(p.type).name : p.type) + '×' + p.count).join('、')}`);
    }
    if (ai.qm && ai.qm.upgrade) lines.push(`[军需官] 升级：${(RTS.CONFIG.upgrades[ai.qm.upgrade] || {}).name || ai.qm.upgrade}`);
    if (ai.qm && ai.qm.towers && ai.qm.towers.length > 0) {
      lines.push(`[军需官] 筑垒：${ai.qm.towers.slice(0, 3).map((t) => t.spot).join(',')}`);
    }
    // v10：微指令占用统计
    let microCount = 0;
    st.enemy.units.forEach((u) => { if (RTS.Unit.microActive(u)) microCount++; });
    lines.push(`敌方微指令占用：${microCount}/${st.enemy.units.size} 单位`);
    if (ai.lastDecision) lines.push(`敌方最近主将决策：${ai.lastDecision.comment || JSON.stringify(ai.lastDecision)}`);
    if (ai.lastDeepseekError) lines.push(`敌方 LLM 状态：${ai.lastDeepseekError}`);
    lines.push(`敌方 LLM 调用次数：${ai.deepseekCount}`);
    lines.push(`玩家资源：🪵${Math.floor(st.player.wood)} 🪨${Math.floor(st.player.stone)}`);
    const up = st.player.upgrades;
    lines.push(`玩家升级：攻${up.attack}/护${up.armor}/城防${up.defense}/破城${up.siegecraft || 0}/疾行${up.mobility || 0}`);
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

  return {
    init,
    update,
    orderProduction,
    toast,
    showOverlay,
    hideOverlay,
    showMenu,
    hideMenu,
    togglePlayerAI,
    getSelectedAIProviders,
    getAITakeoverAtStart,
    aiMessage,
    clearAIMessages,
  };
})();
