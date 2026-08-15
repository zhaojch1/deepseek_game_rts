'use strict';

/**
 * 单位定义：长矛兵（spear）
 * 自包含的「单位技能」文件：数值 + 克制 + AI 元信息 + 绘制 + 供 DeepSeek 阅读的介绍。
 */

RTS.Units.register({
  id: 'spear',
  name: '长矛兵',
  icon: '🔱',
  hotkey: 'Q',

  cost: 60,
  hp: 110,
  attack: 16,
  range: 1.4, // 格（设计值，创建时乘 rangeScale）
  attackInterval: 1.2,
  speed: 2.2, // 格/秒（创建时乘 speedScale）
  trainTime: 2,
  radius: 12,
  color: '#4a90d9',
  ranged: false,

  tags: ['melee', 'infantry', 'anti-cavalry', 'shield', 'frontline', 'cheap'],
  bonusVs: { cavalry: 1.6 },

  ai: {
    role: 'frontline',
    weight: 1,
    desc: '廉价抗线前排，反骑兵',
  },

  doc: '长矛兵（spear）：廉价的前排抗线单位。生命110、攻击16、近战射程1.4、攻速1.2s、移速2.2格/s、成本60、训练2s。克制骑兵（对骑兵伤害×1.6），性价比高，适合前期量产与反制敌方骑兵。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 盾（后臂）
    ctx.fillStyle = kit.tunicDark(v.owner);
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-r * 0.55, -r * 0.15, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 长矛（突刺动画）
    const thrust = Math.sin(v.strike * Math.PI) * r * 0.5;
    const sy = -r * 0.15;
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, sy);
    ctx.lineTo(r * 1.5 + thrust, sy);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.moveTo(r * 1.4 + thrust, sy - r * 0.22);
    ctx.lineTo(r * 1.9 + thrust, sy);
    ctx.lineTo(r * 1.4 + thrust, sy + r * 0.22);
    ctx.closePath();
    ctx.fill();
  },
});
