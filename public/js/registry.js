'use strict';

/**
 * registry.js — 单位与地图的「技能/定义」注册表 + 通用绘制工具库
 *
 * 设计目标（v4 重构）：
 *  - 新增单位：只需在 js/units/ 下新增一个定义文件并在 index.html 加一行 <script>，
 *    无需改动 unit.js / combat.js / render.js / ai.js / production.js 等底层代码。
 *  - 新增地图：只需在 js/maps/ 下新增一个定义文件并加一行 <script>，
 *    无需改动 world.js / ai.js 等底层代码。
 *  - 每个定义自带 `doc`（供 DeepSeek 阅读的详细中文介绍）与结构化元信息，
 *    服务端在启动时读取这些定义，动态生成 AI 提示并校验决策字段。
 */

RTS.Units = (function () {
  const defs = new Map();

  /** 注册一个单位定义（幂等：同 id 覆盖）。 */
  function register(def) {
    if (!def || !def.id) throw new Error('RTS.Units.register: 缺少 id');
    if (!def.draw) throw new Error('RTS.Units.register: 单位 ' + def.id + ' 缺少 draw 函数');
    defs.set(def.id, def);
    return def;
  }

  function get(id) {
    return defs.get(id);
  }
  function has(id) {
    return defs.has(id);
  }
  function all() {
    return Array.from(defs.values());
  }
  function ids() {
    return Array.from(defs.keys());
  }

  /** 设计射程（格）→ 世界像素射程 */
  function rangePx(id) {
    const def = get(id);
    return def ? def.range * RTS.CONFIG.rangeScale : 0;
  }

  /** 克制倍率：attacker 对 defender 的伤害乘数（来自 attacker.bonusVs，默认 1.0） */
  function counterMul(attacker, defender) {
    const def = get(attacker);
    if (!def || !def.bonusVs) return 1.0;
    return def.bonusVs[defender] ?? 1.0;
  }

  /** 供 AI / 文档导出的纯数据描述（剥离函数） */
  function toDoc() {
    return all().map((d) => ({
      id: d.id,
      name: d.name,
      icon: d.icon || '',
      hotkey: d.hotkey || '',
      cost: d.cost,
      hp: d.hp,
      attack: d.attack,
      range: d.range,
      attackInterval: d.attackInterval,
      speed: d.speed,
      trainTime: d.trainTime,
      radius: d.radius,
      ranged: !!d.ranged,
      tags: d.tags || [],
      bonusVs: d.bonusVs || {},
      ai: d.ai || {},
      doc: d.doc || '',
    }));
  }

  return { register, get, has, all, ids, rangePx, counterMul, toDoc };
})();

RTS.Maps = (function () {
  const defs = new Map();
  let activeId = null;

  function register(def) {
    if (!def || !def.id) throw new Error('RTS.Maps.register: 缺少 id');
    if (!def.generate) throw new Error('RTS.Maps.register: 地图 ' + def.id + ' 缺少 generate 函数');
    defs.set(def.id, def);
    return def;
  }

  function get(id) {
    return defs.get(id);
  }
  function has(id) {
    return defs.has(id);
  }
  function all() {
    return Array.from(defs.values());
  }
  function ids() {
    return Array.from(defs.keys());
  }

  function activate(id) {
    activeId = id;
  }

  /** 当前激活的地图定义（默认取 config.defaultMap） */
  function current() {
    return defs.get(activeId || RTS.CONFIG.defaultMap);
  }

  /** 供 AI / 文档导出的纯数据描述（剥离 generate 函数） */
  function toDoc() {
    return all().map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      width: d.width,
      height: d.height,
      playerBase: d.playerBase,
      enemyBase: d.enemyBase,
      lanes: d.lanes || [],
      chokepoints: d.chokepoints || [],
      bridges: d.bridges || [],
      resourceCount: (d.resources || []).length,
      doc: d.doc || '',
    }));
  }

  return { register, get, has, all, ids, activate, current, toDoc };
})();

// ---------------------------------------------------------------- 绘制工具库
// 各单位 draw(ctx, v) 可复用这些通用人形/马匹图元，非人形单位可自行从零绘制。

RTS.Units.drawKit = (function () {
  const PAL = {
    skin: '#e8c39a',
    skinShade: '#c99f72',
    metal: '#d7dee8',
    steel: '#8fa3c2',
    wood: '#8a5a34',
    dark: '#22252c',
    leather: '#6b4a2a',
  };

  function tunic(owner) {
    return owner === 'player' ? '#3d7bd8' : '#c94545';
  }
  function tunicDark(owner) {
    return owner === 'player' ? '#2b5aa8' : '#8f3232';
  }

  /**
   * 通用人形基底（腿/躯干/头+头盔）。返回 { hx, hy }（头心位置）。
   * v: { u, r, p, moving, owner }
   */
  function humanoid(ctx, v) {
    const r = v.r;
    const bob = v.moving ? Math.sin(v.p) * r * 0.12 : 0;

    // 腿
    ctx.strokeStyle = PAL.dark;
    ctx.lineWidth = r * 0.24;
    ctx.lineCap = 'round';
    const legSwing = v.moving ? Math.sin(v.p) * r * 0.3 : 0;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.2);
    ctx.lineTo(-r * 0.2, r * 0.75 + legSwing);
    ctx.moveTo(0, r * 0.2);
    ctx.lineTo(r * 0.25, r * 0.75 - legSwing);
    ctx.stroke();

    // 躯干
    ctx.fillStyle = tunic(v.owner);
    ctx.beginPath();
    ctx.ellipse(r * 0.05, -r * 0.15 + bob, r * 0.55, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tunicDark(v.owner);
    ctx.beginPath();
    ctx.ellipse(r * 0.05, -r * 0.15 + bob, r * 0.55, r * 0.28, 0, 0, Math.PI);
    ctx.fill();

    // 头 + 头盔
    const hx = r * 0.28;
    const hy = -r * 0.95 + bob;
    ctx.fillStyle = PAL.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.metal;
    ctx.beginPath();
    ctx.arc(hx, hy - r * 0.06, r * 0.42, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#5a6470';
    ctx.fillRect(hx + r * 0.28, hy - r * 0.18, r * 0.12, r * 0.3);

    return { hx, hy };
  }

  /**
   * 通用马匹基底（马身/腿/头/鬃），骑兵复用。
   * v: { u, r, p, moving, owner }
   */
  function mount(ctx, v) {
    const r = v.r;
    const bob = v.moving ? Math.sin(v.p) * r * 0.08 : 0;
    const horse = v.owner === 'player' ? '#8a6a3a' : '#7a3a2a';

    ctx.fillStyle = horse;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1 + bob, r * 1.15, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = r * 0.16;
    const swing = v.moving ? Math.sin(v.p) * r * 0.4 : 0;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, r * 0.4);
    ctx.lineTo(-r * 0.8, r * 0.85 + swing);
    ctx.moveTo(-r * 0.3, r * 0.45);
    ctx.lineTo(-r * 0.25, r * 0.85 - swing);
    ctx.moveTo(r * 0.3, r * 0.45);
    ctx.lineTo(r * 0.35, r * 0.85 + swing);
    ctx.moveTo(r * 0.7, r * 0.4);
    ctx.lineTo(r * 0.8, r * 0.85 - swing);
    ctx.stroke();

    ctx.fillStyle = horse;
    ctx.beginPath();
    ctx.ellipse(r * 1.0, -r * 0.25 + bob, r * 0.5, r * 0.28, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.ellipse(r * 1.05, -r * 0.5 + bob, r * 0.3, r * 0.12, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return { PAL, tunic, tunicDark, humanoid, mount };
})();
