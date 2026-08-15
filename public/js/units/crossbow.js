'use strict';

/**
 * 单位定义：弩手（crossbow）
 * 自包含的「单位技能」文件：数值 + 克制 + AI 元信息 + 绘制 + 供 DeepSeek 阅读的介绍。
 * 相比弓箭手：射速更慢、攻击距离更远、攻击力更高。
 */

RTS.Units.register({
  id: 'crossbow',
  name: '弩手',
  icon: '🎯',
  hotkey: 'T',

  cost: 110,
  hp: 75,
  attack: 24,
  range: 7.0, // 格（比弓箭手 5.5 更远）
  attackInterval: 2.2, // 秒（比弓箭手 1.4 更慢）
  speed: 2.0,
  trainTime: 2, // v7.2：训练时长减半
  radius: 11,
  color: '#c07a2a',
  ranged: true,

  tags: ['ranged', 'infantry', 'ranged-dps', 'long-range', 'armor-pierce', 'fragile'],
  bonusVs: { cavalry: 1.3, sword: 1.1 }, // 弩箭破甲，克制骑兵与持盾刀盾

  ai: {
    role: 'ranged',
    weight: 1,
    desc: '远程重弩：射程远、攻速慢、单发高',
  },

  doc: '弩手（crossbow）：远程重弩单位。生命75、攻击24、远程射程7.0格（比弓箭手更远）、攻速2.2s（比弓箭手更慢）、移速2.0格/s、成本110、训练2s。弩箭破甲：对骑兵伤害×1.3、对刀盾兵×1.1。单发伤害高、射程远，但装填慢，怕近战贴身与骑兵快速切入。适合后排集火点杀高价值目标与反重装。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 弩朝目标上仰/下俯（aimAngle），拉弦/后座动画
    const aim = v.u.aimAngle || 0;
    const reload = (v.strike || v.recoil) * r * 0.4;
    ctx.save();
    ctx.translate(r * 0.35, -r * 0.2);
    ctx.rotate(aim);

    // 弩身（横木）
    ctx.fillStyle = kit.PAL.wood;
    ctx.fillRect(-r * 0.15, -r * 0.08, r * 1.3, r * 0.16);

    // 弩臂（横向弓臂，弯曲）
    ctx.strokeStyle = kit.PAL.steel;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.arc(r * 0.45, 0, r * 0.5, -1.2, 1.2);
    ctx.stroke();

    // 弩弦
    ctx.strokeStyle = '#e8eef7';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.45 + Math.cos(-1.2) * r * 0.5, Math.sin(-1.2) * r * 0.5);
    ctx.lineTo(r * 1.15 - reload, 0);
    ctx.lineTo(r * 0.45 + Math.cos(1.2) * r * 0.5, Math.sin(1.2) * r * 0.5);
    ctx.stroke();

    // 弩箭（粗短箭杆 + 箭头，指向瞄准方向）
    ctx.strokeStyle = kit.PAL.steel;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, 0);
    ctx.lineTo(r * 1.35, 0);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.moveTo(r * 1.35, -r * 0.14);
    ctx.lineTo(r * 1.55, 0);
    ctx.lineTo(r * 1.35, r * 0.14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  },
});
