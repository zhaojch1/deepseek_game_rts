'use strict';

/**
 * 单位定义：骑射手（horse_archer）—— v8 新增
 * 游走骑射：高速远程风筝单位。移速接近骑兵但射程比步兵弓箭手短，
 * 专克慢速重装（锤子兵/肉盾/长矛兵），但被弓箭手/弩手放风筝、被骑兵冲锋碾压。
 */

RTS.Units.register({
  id: 'horse_archer',
  name: '骑射手',
  icon: '🏇',
  hotkey: 'U',

  cost: 130,
  hp: 85,
  attack: 12,
  range: 4.8, // 格（比弓箭手 5.5 短，无法白嫖弓箭手）
  attackInterval: 1.5,
  speed: 3.8, // 高速（仅次于骑兵 4.2）
  trainTime: 2,
  radius: 12,
  color: '#6aa84f',
  ranged: true,

  tags: ['ranged', 'cavalry', 'fast', 'flanker', 'skirmish', 'fragile'],
  bonusVs: { spear: 1.1, hammer: 1.3, wall: 0.9, archer: 0.8, crossbow: 0.8, cavalry: 0.8 },

  ai: {
    role: 'skirmisher',
    weight: 1,
    desc: '骑射游走：风筝慢速重装，怕骑兵与远程对射',
  },

  doc: '骑射手（horse_archer）：高速骑射风筝单位。生命85、攻击12、远程射程4.8格（短于弓箭手）、攻速1.5s、移速3.8格/s（全场第二快）、成本130、训练2s。马上射击：对长矛兵×1.1、对锤子兵×1.3、对肉盾×0.9；但马背拉弓精度差，对弓箭手×0.8、对弩手×0.8、对冲过来的骑兵×0.8。适合绕后风筝锤子兵/肉盾/长矛兵等慢速目标，打游击战；切忌与弓箭手/弩手对射或被骑兵突脸。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.mount(ctx, v);

    const bob = v.moving ? Math.sin(v.p) * r * 0.08 : 0;

    // 骑手（轻装，戴皮帽）
    ctx.fillStyle = kit.tunic(v.owner);
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, -r * 0.6 + bob, r * 0.42, r * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.PAL.skin;
    ctx.beginPath();
    ctx.arc(-r * 0.05, -r * 1.12 + bob, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.PAL.leather;
    ctx.beginPath();
    ctx.arc(-r * 0.05, -r * 1.16 + bob, r * 0.34, Math.PI, 0);
    ctx.fill();

    // 短弓（朝瞄准方向，拉弓动画）
    const aim = v.u.aimAngle || 0;
    const pull = (v.strike || v.recoil) * r * 0.5;
    ctx.save();
    ctx.translate(r * 0.35, -r * 0.55 + bob);
    ctx.rotate(aim);
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, -1.0, 1.0);
    ctx.stroke();
    ctx.strokeStyle = '#e8eef7';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(-1.0) * r * 0.72, Math.sin(-1.0) * r * 0.72);
    ctx.lineTo(-pull, 0);
    ctx.lineTo(Math.cos(1.0) * r * 0.72, Math.sin(1.0) * r * 0.72);
    ctx.stroke();
    ctx.restore();
  },
});
