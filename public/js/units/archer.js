'use strict';

/**
 * 单位定义：弓箭手（archer）
 */

RTS.Units.register({
  id: 'archer',
  name: '弓箭手',
  icon: '🏹',
  hotkey: 'E',

  cost: 80,
  hp: 70,
  attack: 13,
  range: 5.5,
  attackInterval: 1.4,
  speed: 2.0,
  trainTime: 1.5, // v7.2：训练时长减半
  radius: 11,
  color: '#d9a03a',
  ranged: true,

  tags: ['ranged', 'infantry', 'ranged-dps', 'fragile'],
  bonusVs: { sword: 0.7 }, // 盾牌减伤

  ai: {
    role: 'ranged',
    weight: 1,
    desc: '远程输出，脆皮',
  },

  doc: '弓箭手（archer）：远程输出单位。生命70、攻击13、远程射程5.5格、攻速1.4s、移速2.0格/s、成本80、训练1.5s。对刀盾兵伤害×0.7（盾牌减伤）。射程远可风筝近战，但脆皮、被骑兵快速切入克制。建议置于后排输出。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 弓朝目标上仰/下俯（aimAngle），拉弓动画
    const pull = (v.strike || v.recoil) * r * 0.55;
    const aim = v.u.aimAngle || 0;
    ctx.save();
    ctx.translate(r * 0.3, -r * 0.15);
    ctx.rotate(aim);
    ctx.translate(-r * 0.3, r * 0.15);

    // 弓臂
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.15, r * 0.85, -1.1, 1.1);
    ctx.stroke();
    // 弓弦
    ctx.strokeStyle = '#e8eef7';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.3 + Math.cos(-1.1) * r * 0.85, -r * 0.15 + Math.sin(-1.1) * r * 0.85);
    ctx.lineTo(r * 0.3 - pull, -r * 0.15);
    ctx.lineTo(r * 0.3 + Math.cos(1.1) * r * 0.85, -r * 0.15 + Math.sin(1.1) * r * 0.85);
    ctx.stroke();
    // 箭（搭在弦上，指向瞄准方向）
    if (v.strike > 0 || v.recoil > 0) {
      ctx.strokeStyle = kit.PAL.wood;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.3 - pull, -r * 0.15);
      ctx.lineTo(r * 0.3 + r * 0.9, -r * 0.15);
      ctx.stroke();
      ctx.fillStyle = kit.PAL.steel;
      ctx.beginPath();
      ctx.moveTo(r * 0.3 + r * 0.9, -r * 0.15 - 3);
      ctx.lineTo(r * 0.3 + r * 1.15, -r * 0.15);
      ctx.lineTo(r * 0.3 + r * 0.9, -r * 0.15 + 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
});
