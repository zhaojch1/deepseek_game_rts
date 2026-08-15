'use strict';

/**
 * 单位定义：骑兵（cavalry）
 */

RTS.Units.register({
  id: 'cavalry',
  name: '骑兵',
  icon: '🐴',
  hotkey: 'R',

  cost: 120,
  hp: 130,
  attack: 20,
  range: 1.0,
  attackInterval: 1.5,
  speed: 4.2,
  trainTime: 2, // v7.2：训练时长减半
  radius: 14,
  color: '#d95a5a',
  ranged: false,

  tags: ['melee', 'cavalry', 'fast', 'flanker', 'shock'],
  bonusVs: { spear: 0.7, sword: 1.1, archer: 1.5 },

  ai: {
    role: 'flanker',
    weight: 1,
    desc: '高速高攻突击，克弓箭与刀盾',
  },

  doc: '骑兵（cavalry）：高速高攻突击单位。生命130、攻击20、近战射程1.0、攻速1.5s、移速4.2格/s（全场最快）、成本120、训练2s。克制弓箭手（×1.5）与刀盾兵（×1.1），但被长矛兵的反骑兵加成克制（对长矛×0.7）。适合快速支援、切后排与劫掠。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.mount(ctx, v);

    const bob = v.moving ? Math.sin(v.p) * r * 0.08 : 0;

    // 骑手
    ctx.fillStyle = kit.tunic(v.owner);
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, -r * 0.6 + bob, r * 0.45, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.PAL.skin;
    ctx.beginPath();
    ctx.arc(-r * 0.05, -r * 1.15 + bob, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.PAL.metal;
    ctx.beginPath();
    ctx.arc(-r * 0.05, -r * 1.2 + bob, r * 0.36, Math.PI, 0);
    ctx.fill();

    // 骑枪
    const thrust = Math.sin(v.strike * Math.PI) * r * 0.4;
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.6 + bob);
    ctx.lineTo(r * 1.6 + thrust, -r * 0.85 + bob);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.moveTo(r * 1.5 + thrust, -r * 0.85 + bob - r * 0.18);
    ctx.lineTo(r * 2.0 + thrust, -r * 0.85 + bob);
    ctx.lineTo(r * 1.5 + thrust, -r * 0.85 + bob + r * 0.18);
    ctx.closePath();
    ctx.fill();
  },
});
