'use strict';

/**
 * 单位定义：锤子兵（hammer）—— v8 新增
 * 重锤破甲：慢速高攻的近战攻城单位，专克持盾/重甲目标，但移速慢、追不上远程。
 */

RTS.Units.register({
  id: 'hammer',
  name: '锤子兵',
  icon: '🔨',
  hotkey: 'Y',

  cost: 100,
  hp: 140,
  attack: 24,
  range: 1.1, // 格（设计值，创建时乘 rangeScale）
  attackInterval: 1.7, // 重锤挥击慢
  speed: 1.7, // 慢速，追不上远程
  trainTime: 1.8,
  radius: 13,
  color: '#8a7a5a',
  ranged: false,
  baseMul: 1.5, // v8：重锤对基地额外伤害（攻城定位）

  tags: ['melee', 'infantry', 'anti-armor', 'siege', 'shock', 'slow'],
  bonusVs: { sword: 1.4, crossbow: 1.2, wall: 1.4, archer: 0.85, spear: 0.85 },

  ai: {
    role: 'siege',
    weight: 1,
    desc: '重锤破甲：克刀盾/弩手/肉盾，攻城伤害高',
  },

  doc: '锤子兵（hammer）：重锤破甲的慢速近战单位。生命140、攻击24、近战射程1.1、攻速1.7s（慢）、移速1.7格/s（慢）、成本100、训练1.8s。重锤可砸穿护甲与盾牌：对刀盾兵×1.4、对弩手×1.2、对肉盾×1.4，且对敌方基地额外造成×1.5伤害（攻城利器）；但速度慢，对弓箭手×0.85、对长矛兵×0.85，追不上远程部队，且挥击慢、怕被刀盾海包围。适合混在肉盾后输出重装目标与攻城拔寨，克制敌方肉盾/弩手集群。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 双手大锤（挥击动画）
    const swing = Math.sin(v.strike * Math.PI) * r * 0.6;
    ctx.save();
    ctx.translate(r * 0.1, -r * 0.3);
    ctx.rotate(-0.45 + swing * 0.85);
    // 锤柄
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.75);
    ctx.lineTo(r * 0.15, -r * 0.85);
    ctx.stroke();
    // 锤头
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 1.15, r * 1.6, r * 0.62, r * 0.16);
    ctx.fill();
    ctx.fillStyle = '#5a6470';
    ctx.fillRect(-r * 0.8, -r * 1.15, r * 1.6, r * 0.2);
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 1.15, r * 1.6, r * 0.62, r * 0.16);
    ctx.stroke();
    ctx.restore();
  },
});
