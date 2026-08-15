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
    el.debugPanel = document.getElementById('debug-panel');
    el.prodButtons = Array.from(document.querySelectorAll('.prod-btn'));

    el.prodButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        orderProduction(btn.dataset.type);
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
    el.pop.textContent = player.units.size;
    el.time.textContent = fmtTime(st.time);

    // AI 来源
    if (st.ai.deepseekActive) {
      el.aiSource.textContent = 'AI：DeepSeek';
      el.aiSource.classList.add('deepseek');
    } else {
      el.aiSource.textContent = 'AI：规则';
      el.aiSource.classList.remove('deepseek');
    }

    // 生产按钮状态
    const types = ['spear', 'sword', 'archer', 'cavalry'];
    el.prodButtons.forEach((btn) => {
      const type = btn.dataset.type;
      const s = RTS.Unit.typeStats(type);
      const costEl = btn.querySelector('.prod-cost');
      costEl.textContent = s.cost;
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
    if (st.selection.size === 0) {
      el.selectionPanel.classList.add('hidden');
      return;
    }
    el.selectionPanel.classList.remove('hidden');
    const counts = { spear: 0, sword: 0, archer: 0, cavalry: 0 };
    let total = 0;
    let totalHp = 0;
    let maxHp = 0;
    st.selection.forEach((id) => {
      const u = st.player.units.get(id);
      if (!u || u.hp <= 0) return;
      counts[u.type]++;
      total++;
      totalHp += u.hp;
      maxHp += u.maxHp;
    });
    el.selectionTitle.textContent = `已选 ${total} 单位`;
    const names = [];
    for (const t of ['spear', 'sword', 'archer', 'cavalry']) {
      if (counts[t] > 0) names.push(`${RTS.Unit.typeStats(t).name}×${counts[t]}`);
    }
    el.selectionDetail.textContent =
      names.join('  ') + (maxHp > 0 ? `  ·  平均血量 ${Math.round((totalHp / maxHp) * 100)}%` : '');
  }

  function updateDebugPanel(st) {
    const ai = st.ai;
    const lines = [];
    lines.push(`时间 ${fmtTime(st.time)}   FPS ${st.fps ?? 0}`);
    lines.push(`AI 来源：${ai.deepseekActive ? 'DeepSeek' : '规则'}`);
    lines.push(`AI 进攻倾向：${ai.strategy.aggression}`);
    if (ai.strategy.armyFocus) lines.push(`AI 兵种倾向：${RTS.Unit.typeStats(ai.strategy.armyFocus).name}`);
    if (ai.lastDecision) lines.push(`最近决策：${ai.lastDecision.comment || JSON.stringify(ai.lastDecision)}`);
    if (ai.lastDeepseekError) lines.push(`DeepSeek 状态：${ai.lastDeepseekError}`);
    lines.push(`DeepSeek 调用次数：${ai.deepseekCount}`);
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

  return { init, update, orderProduction, toast, showOverlay, hideOverlay };
})();
