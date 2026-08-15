'use strict';

/**
 * v7.1 DOM 集成冒烟测试：
 * 用最小 DOM stub 按 index.html 顺序加载全部前端模块（含 render/ui/input/main），
 * 验证：
 *   1. boot 初始化无异常（UI.init / Render.init / Input.init）
 *   2. 主菜单勾选「开局即由 AI 接管」→ RTS.Match.start() 后 RTS.state.playerAI 立即存在
 *   3. RTS.UI.aiMessage 每侧最多保留 5 条，超出后最老一条开始淡出（fading）
 * 运行：node tools/dom_smoke.js
 */

const fs = require('fs');
const vm = require('vm');

// ---------------------------------------------------------------- 最小 DOM stub

function makeEl(tag) {
  const el = {
    tagName: tag || 'div',
    children: [],
    dataset: {},
    style: {},
    width: 0,
    height: 0,
    checked: false,
    value: '',
    parentNode: null,
    firstElementChild: null,
    classSet: new Set(),
    classList: {
      add: (...c) => c.forEach((x) => el.classSet.add(x)),
      remove: (...c) => c.forEach((x) => el.classSet.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (el.classSet.has(c)) el.classSet.delete(c);
          else el.classSet.add(c);
        } else if (force) el.classSet.add(c);
        else el.classSet.delete(c);
      },
      contains: (c) => el.classSet.has(c),
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      if (!el.firstElementChild) el.firstElementChild = child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      if (el.firstElementChild === child) el.firstElementChild = el.children[0] || null;
    },
    querySelector() {
      return makeEl('span');
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return new Proxy(
        {},
        {
          get: (t, k) => {
            if (k === 'canvas') return el;
            return t[k] || (() => {});
          },
        }
      );
    },
  };
  Object.defineProperty(el, 'textContent', {
    get: () => el._text || '',
    set: (v) => { el._text = String(v); },
  });
  // 与浏览器一致：className 与 classList 同步
  Object.defineProperty(el, 'className', {
    get: () => Array.from(el.classSet).join(' '),
    set: (v) => {
      el.classSet.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classSet.add(c));
    },
  });
  Object.defineProperty(el, 'nextElementSibling', {
    get: () => {
      const i = el.parentNode ? el.parentNode.children.indexOf(el) : -1;
      return i >= 0 ? el.parentNode.children[i + 1] || null : null;
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html || '',
    set: (v) => {
      el._html = String(v);
      el.children = [];
      el.firstElementChild = null;
    },
  });
  return el;
}

const elements = new Map();
global.window = global;
global.window.innerWidth = 1280;
global.window.innerHeight = 720;
global.window.devicePixelRatio = 1;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl('div'));
    return elements.get(id);
  },
  createElement(tag) {
    return makeEl(tag);
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
};
global.CanvasRenderingContext2D = function () {};
global.requestAnimationFrame = () => {}; // 主循环不跑，只验证初始化

// fetch stub：返回合法决策
global.fetch = async () => ({
  json: async () => ({
    ok: true,
    source: 'deepseek',
    decision: {
      armyFocus: 'sword',
      aggression: 60,
      stance: 'rally',
      lane: 'mid',
      targetFocus: 'army',
      attackNow: false,
      comment: 'DOM 测试决策',
    },
  }),
});

// ---------------------------------------------------------------- 按 index.html 顺序加载

const files = [
  'public/js/config.js',
  'public/js/registry.js',
  'public/js/units/spear.js',
  'public/js/units/sword.js',
  'public/js/units/archer.js',
  'public/js/units/crossbow.js',
  'public/js/units/cavalry.js',
  'public/js/units/hammer.js',
  'public/js/units/horse_archer.js',
  'public/js/units/wall.js',
  'public/js/maps/valley_river.js',
  'public/js/maps/wide_river.js',
  'public/js/maps/grand_basin.js',
  'public/js/world.js',
  'public/js/pathfinding.js',
  'public/js/camera.js',
  'public/js/unit.js',
  'public/js/combat.js',
  'public/js/production.js',
  'public/js/resources.js',
  'public/js/projectiles.js',
  'public/js/ai.js',
  'public/js/input.js',
  'public/js/render.js',
  'public/js/ui.js',
  'public/js/main.js',
];

for (const f of files) {
  vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
}

(async () => {
  let pass = true;

  // 1) 主菜单勾选「开局即由 AI 接管」并开局
  document.getElementById('menu-ai-takeover').checked = true;
  document.getElementById('ai-provider-player').value = 'doubao';
  RTS.Maps.activate('valley_river');
  RTS.Match.start();
  if (!RTS.state) {
    console.log('FAIL: start() 后应有 RTS.state');
    pass = false;
  } else if (!RTS.state.playerAI) {
    console.log('FAIL: 勾选开局接管后，start() 应创建 RTS.state.playerAI');
    pass = false;
  } else {
    console.log('OK: 开局即由 AI 接管，玩家 AI provider =', RTS.state.playerAI.provider,
      '敌方 AI provider =', RTS.state.ai.provider);
  }
  // 接管后出兵/升级按钮应为禁用态
  RTS.UI.update(1 / 60);
  const prodBtns = document.getElementById('production-buttons').children;
  if (prodBtns.length === 0) console.log('WARN: 无 prod-btn（stub 环境），跳过按钮禁用检查');
  else {
    const allDisabled = prodBtns.every((b) => b.classList.contains('disabled'));
    console.log('OK: AI 接管时出兵按钮全部禁用 =', allDisabled, '（按钮数', prodBtns.length + '）');
  }

  // 2) aiMessage 上限与淡出（一次只淡出最老一条，淡出中的消息不重复标记）
  const box = document.getElementById('ai-msg-player');
  for (let i = 1; i <= 7; i++) RTS.UI.aiMessage('player', '消息' + i);
  const total = box.children.length;
  const fading = box.children.filter((c) => c.classList.contains('fading')).length;
  const visible = total - fading;
  console.log('OK: 塞入 7 条后容器共', total, '条，可见(未淡出)', visible, '条，淡出中', fading, '条');
  if (visible !== 5) {
    console.log('FAIL: 可见消息应最多 5 条，实际', visible);
    pass = false;
  }
  if (fading !== 2) {
    console.log('FAIL: 超出部分应标记为淡出（2 条），实际', fading);
    pass = false;
  }
  const box2 = document.getElementById('ai-msg-enemy');
  RTS.UI.aiMessage('enemy', '敌方消息');
  if (box2.children.length !== 1 || !box2.children[0].classList.contains('enemy')) {
    console.log('FAIL: 敌方消息应进入右侧容器');
    pass = false;
  } else {
    console.log('OK: 敌方消息进入右侧容器');
  }

  // 3) 清理
  RTS.UI.clearAIMessages();
  if (box.children.length !== 0 || box2.children.length !== 0) {
    console.log('FAIL: clearAIMessages 后两侧应清空');
    pass = false;
  } else {
    console.log('OK: clearAIMessages 清空两侧');
  }
  RTS.Match.toMenu();
  if (RTS.state !== null) {
    console.log('FAIL: toMenu 后 state 应为 null');
    pass = false;
  }

  console.log(pass ? 'DOM SMOKE TEST PASSED' : 'DOM SMOKE TEST FAILED');
  process.exit(pass ? 0 : 1);
})();
