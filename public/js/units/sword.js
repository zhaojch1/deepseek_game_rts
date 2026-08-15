'use strict';

/**
 * 单位定义：刀盾兵（sword）
 */

RTS.Units.register({
  id: 'sword',
  name: '刀盾兵',
  icon: '🛡️',
  hotkey: 'W',

  cost: 70,
  hp: 150,
  attack: 13,
  range: 1.0,
  attackInterval: 1.0,
  speed: 2.0,
  trainTime: 1.33, // v7.2：训练时长减半
  radius: 13,
  color: '#8a6bd9',
  ranged: false,

  tags: ['melee', 'infantry', 'shield', 'tank', 'frontline'],
  bonusVs: { spear: 1.2, archer: 1.3, cavalry: 0.8 },

  ai: {
    role: 'tank',
    weight: 1,
    desc: '高生命肉盾，克长矛与弓箭',
  },

  doc: '刀盾兵（sword）：高生命肉盾单位。生命150、攻击13、近战射程1.0、攻速1.0s、移速2.0格/s、成本70、训练约1.3s。克制长矛兵（×1.2）与弓箭手（×1.3），但被骑兵冲击克制（对骑兵×0.8）。适合前排吸收伤害。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 盾（前臂，持盾减伤）
    ctx.fillStyle = kit.tunicDark(v.owner);
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(r * 0.2, -r * 0.55, r * 0.75, r * 0.95, r * 0.2);
    ctx.fill();
    ctx.stroke();

    // 剑（挥击动画）
    const ang = -1.1 + (v.strike || v.recoil) * 1.6;
    ctx.save();
    ctx.translate(r * 0.1, -r * 0.1);
    ctx.rotate(ang);
    ctx.fillStyle = kit.PAL.steel;
    ctx.fillRect(0, -r * 0.08, r * 1.5, r * 0.16);
    ctx.fillStyle = kit.PAL.metal;
    ctx.fillRect(r * 1.3, -r * 0.14, r * 0.28, r * 0.28);
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, 0);
    ctx.lineTo(-r * 0.4, 0);
    ctx.stroke();
    ctx.restore();
  },
});
