# Skill：创建新单位（create_unit）

> 用途：在本项目中新增一种可生产的兵种。按本文档操作即可，**无需改动任何底层代码**（unit.js / combat.js / render.js / ai.js / production.js / ui.js / input.js 全部自动适配）。

---

## 一、前置认知

- 每个单位是 `public/js/units/<id>.js` 下的一个**自包含定义文件**，通过 `RTS.Units.register({...})` 注册。
- 运行时由 `RTS.Unit.create(owner, typeId, x, y)` 工厂从注册表取定义并构造实体；移动/状态机/索敌/伤害结算与具体单位无关。
- 克制系统是**数据驱动**的：`bonusVs` 记录「攻击某兵种时的伤害倍率」，战斗结算经 `RTS.Units.counterMul(attacker, defender)` 动态查询（默认 1.0）。
- 单位绘制由定义里的 `draw(ctx, v)` 自己负责；`render.js` 只做通用包装（平移/缩放/阴影/受击白闪）。
- 每个单位定义自带 `doc`（中文详细介绍），`server.js` 启动时自动读入并注入 DeepSeek 系统提示 + 校验 `armyFocus`，因此**新增单位后 AI 天然认识它**。

## 二、三步快速上手

1. 复制 `public/js/units/sword.js` → `public/js/units/<新id>.js`，改字段与 `draw`。
2. 在 `public/index.html` 的 `units/` 脚本段加一行 `<script src="js/units/<新id>.js"></script>`。
3. 运行 `node tools/build_intro.js` 刷新 `public/data/units.md`（可选，但建议，供 AI/人类阅读）。

完成后：生产面板按钮、快捷键、AI 生产决策、克制结算、绘制、DeepSeek 决策全部自动生效。

## 三、定义字段（完整 schema）

```js
RTS.Units.register({
  // ---- 标识 ----
  id: 'crossbow',            // 唯一 id（英文，全局唯一；AI 的 armyFocus 用它）
  name: '弩手',              // 显示名（中文）
  icon: '🎯',                // 生产面板 emoji 图标
  hotkey: 'T',               // 生产快捷键（大写字母；不能与已有单位/系统键冲突）

  // ---- 数值（设计值）----
  cost: 110,                 // 成本（军费）
  hp: 75,                    // 生命
  attack: 24,                // 攻击力
  range: 7.0,                // 射程，单位「格」；实际像素 = range * CONFIG.rangeScale(34)
  attackInterval: 2.2,       // 攻击间隔（秒），越大射速越慢
  speed: 2.0,                // 移速，单位「格/秒」；实际像素 = speed * CONFIG.speedScale(48)
  trainTime: 4,              // 训练时间（秒）
  radius: 11,                // 碰撞/绘制半径（px），近战 12~14、远程 11 左右
  color: '#c07a2a',          // 兜底圆形占位色（有 draw 时基本用不到）
  ranged: true,              // 是否远程（true=射实体箭，false=近战挥击）

  // ---- 克制（数据驱动，可选）----
  bonusVs: { cavalry: 1.3, sword: 1.1 }, // 攻击这些兵种时的伤害倍率（缺省 1.0）

  // ---- 标签（供 AI 用，可选但推荐）----
  tags: ['ranged', 'infantry', 'long-range', 'armor-pierce', 'fragile'],
  // 常见标签：'melee'|'ranged'|'infantry'|'cavalry'|'fast'|'shield'|'tank'|'frontline'|
  //          'fragile'|'cheap'|'flanker'|'shock'|'long-range'|'armor-pierce'
  // AI 决策会用到：'fast'/'cavalry'（侦查/劫掠/主攻基地加权）、'ranged'（远程加权）

  // ---- AI 生产元信息（可选）----
  ai: {
    role: 'ranged',           // 定位（仅描述用）
    weight: 1,                // 生产基础权重（越大越常造）
    desc: '远程重弩：射程远、攻速慢、单发高',
  },

  // ---- 供 DeepSeek 阅读的详细中文介绍（必填，越详细 AI 决策越准）----
  doc: '弩手（crossbow）：远程重弩……（生命/攻击/射程/攻速/移速/成本/训练/克制/定位，越全越好）',

  // ---- 绘制函数（必填）----
  draw(ctx, v) { /* 见下文 */ },
});
```

## 四、`draw(ctx, v)` 绘制 API

`draw` 被调用时，坐标系已经：`ctx.translate(u.x, u.y)` + `ctx.scale(u.facingX, 1)`。
因此**在本地坐标系中，单位中心在 (0,0)，正面朝向 +x（右）**；阵营朝向（左/右）已由 `facingX` 翻转处理，无需自己处理左右。

`v`（view）对象：

| 字段 | 说明 |
| --- | --- |
| `v.u` | 单位实体，可读 `v.u.aimAngle`（远程瞄准俯仰角）、`v.u.animPhase` 等 |
| `v.r` | 半径（= `radius`） |
| `v.owner` | `'player'` 或 `'enemy'` |
| `v.p` | 行走动画相位（`animPhase`） |
| `v.moving` | 是否移动中 |
| `v.strike` | 攻击前摇进度 0..1（挥击/拉弓） |
| `v.recoil` | 攻击后摇进度 0..1 |

通用图元库 `RTS.Units.drawKit`：

- `kit.PAL`：调色板（`skin/metal/steel/wood/dark/leather`）
- `kit.tunic(owner)` / `kit.tunicDark(owner)`：阵营主/暗色
- `kit.humanoid(ctx, v)`：画人形基底（腿/躯干/头+头盔），返回 `{hx, hy}`
- `kit.mount(ctx, v)`：画马匹基底（骑兵复用）

远程单位要「朝目标上仰/下俯瞄准」时，把武器绘制包在：

```js
const aim = v.u.aimAngle || 0;
ctx.save();
ctx.translate(px, py);   // 武器支点
ctx.rotate(aim);
ctx.translate(-px, -py);
// ... 画弓/弩/枪 ...
ctx.restore();
```

示例（弩手，可直接改）：

```js
draw(ctx, v) {
  const kit = RTS.Units.drawKit;
  const r = v.r;
  kit.humanoid(ctx, v);          // 人形基底

  const aim = v.u.aimAngle || 0;
  const reload = (v.strike || v.recoil) * r * 0.4;
  ctx.save();
  ctx.translate(r * 0.35, -r * 0.2);
  ctx.rotate(aim);

  ctx.fillStyle = kit.PAL.wood;                          // 弩身
  ctx.fillRect(-r * 0.15, -r * 0.08, r * 1.3, r * 0.16);
  ctx.strokeStyle = kit.PAL.steel; ctx.lineWidth = r * 0.14;   // 弩臂
  ctx.beginPath(); ctx.arc(r * 0.45, 0, r * 0.5, -1.2, 1.2); ctx.stroke();
  ctx.strokeStyle = '#e8eef7'; ctx.lineWidth = 1.2;      // 弦
  ctx.beginPath();
  ctx.moveTo(r * 0.45 + Math.cos(-1.2) * r * 0.5, Math.sin(-1.2) * r * 0.5);
  ctx.lineTo(r * 1.15 - reload, 0);
  ctx.lineTo(r * 0.45 + Math.cos(1.2) * r * 0.5, Math.sin(1.2) * r * 0.5);
  ctx.stroke();
  ctx.strokeStyle = kit.PAL.steel; ctx.lineWidth = r * 0.12;   // 弩箭
  ctx.beginPath(); ctx.moveTo(r * 0.3, 0); ctx.lineTo(r * 1.35, 0); ctx.stroke();
  ctx.fillStyle = kit.PAL.steel;
  ctx.beginPath(); ctx.moveTo(r * 1.35, -r * 0.14); ctx.lineTo(r * 1.55, 0); ctx.lineTo(r * 1.35, r * 0.14); ctx.closePath(); ctx.fill();

  ctx.restore();
}
```

## 五、完整可复制模板

把下面内容存为 `public/js/units/<id>.js`，替换 `<...>` 即可：

```js
'use strict';

RTS.Units.register({
  id: '<id>',
  name: '<名称>',
  icon: '<emoji>',
  hotkey: '<字母>',

  cost: 100,
  hp: 100,
  attack: 15,
  range: 1.5,
  attackInterval: 1.2,
  speed: 2.0,
  trainTime: 4,
  radius: 12,
  color: '#999999',
  ranged: false,

  tags: ['melee', 'infantry'],
  bonusVs: { /* '目标id': 倍率 */ },

  ai: { role: '<定位>', weight: 1, desc: '<一句话描述>' },
  doc: '<详细中文介绍：生命/攻击/射程/攻速/移速/成本/训练/克制/定位>',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    kit.humanoid(ctx, v);
    // 在这里画武器/特征
  },
});
```

## 六、验证清单

1. `node --check public/js/units/<id>.js`（语法）。
2. 无头加载注册表：`RTS.Units.ids()` 应包含新 id；`RTS.Units.counterMul(id, 'cavalry')` 返回预期倍率。
3. `RTS.Unit.create('player', id, x, y)` 后检查 `hp/attack/range(px)/attackInterval/ranged`。
4. 用 mock 2D context 调一次 `draw`，确认不抛错（`draw` 用到的 canvas 方法如 `roundRect` 由 render.js 的 polyfill 兜底）。
5. `node tools/build_intro.js` 刷新 `public/data/units.md`，确认新单位已出现。
6. 重启 `node server.js`，确认无「加载定义失败」告警，DeepSeek 的 `armyFocus` 已能接受新 id。

## 七、常见坑

- **`range`/`speed` 是「格」单位**，不是像素；像素值 = 设计值 × scale，别直接把像素填进去。
- **`hotkey` 不能冲突**：现有 Q/W/E/R/T，A 是攻击移动、F2 是调试、空格/方向键是相机。
- **远程单位记得 `ranged: true`**，否则会走近战 `deliverAttack` 而不是射实体箭。
- **`doc` 要写全数值**：DeepSeek 靠它判断兵种强弱与克制，写错会误导 AI 决策。
- 非人形单位可不调 `kit.humanoid`，直接用 `ctx` 从零画；但务必在本地坐标、面向 +x。
