'use strict';

/**
 * 单位定义：投石手（slinger）—— v16 新增
 * 远程AOE单位：投掷石块造成范围伤害，克制密集阵型。
 * 射程中等、攻速慢、单发伤害低但有溅射效果，
 * 对扎堆的步兵群非常有效，但被骑兵快速切入克制。
 */

RTS.Units.register({
  id: 'slinger',
  name: '投石手',
  icon: '🪨',
  hotkey: 'K',

  cost: 90,
  hp: 65, // 脆皮
  attack: 10, // 单发伤害低
  range: 5.0, // 中等射程
  attackInterval: 2.0, // 攻速慢
  speed: 2.0,
  trainTime: 1.8,
  radius: 11,
  color: '#8a7a6a',
  ranged: true,

  tags: ['ranged', 'infantry', 'aoe', 'siege', 'fragile'],
  bonusVs: { spear: 1.3, sword: 1.2, wall: 0.7, cavalry: 0.6 },

  // v16：投石手特色
  special: {
    // AOE溅射：对目标周围造成范围伤害
    splash: {
      radius: 60, // 溅射半径(px)
      damageFalloff: 0.5, // 溅射伤害衰减（中心100%，边缘50%）
      description: '攻击造成范围伤害，半径60px内敌人受到溅射'
    },
    // 破阵：对密集阵型造成额外伤害
    formationBreak: {
      bonusPerUnit: 0.1, // 每多一个溅射目标增加10%伤害
      maxBonus: 0.5, // 最高50%额外伤害
      description: '溅射命中越多目标，伤害越高（最高+50%）'
    },
    // 攻城：对建筑造成额外伤害
    structuralDamage: {
      buildingDamageBonus: 0.3, // 对建筑额外30%伤害
      description: '石块对建筑造成额外30%伤害'
    }
  },

  ai: {
    role: 'aoe',
    weight: 0.9,
    desc: '远程AOE：克制密集步兵群，攻城辅助',
  },

  doc: '投石手（slinger）：远程AOE范围伤害单位。生命65（脆）、攻击10（单发低）、远程射程5.0格、攻速2.0s（慢）、移速2.0格/s、成本90、训练1.8s。特色能力：1）溅射——攻击造成范围伤害，半径60px内敌人受到溅射（中心100%伤害，边缘50%）；2）破阵——溅射命中越多目标伤害越高，每多一个目标+10%伤害，最高+50%；3）攻城——石块对建筑造成额外30%伤害。对长矛兵×1.3、对刀盾兵×1.2；但对肉盾×0.7、对骑兵×0.6。适合攻击敌方密集步兵群，尤其是长矛方阵和刀盾集群；但单体伤害低、攻速慢，被骑兵快速切入会迅速阵亡，需要近战保护。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 投石索（Y形弹弓）
    const aim = v.u.aimAngle || 0;
    const pull = (v.strike || v.recoil) * r * 0.6;
    ctx.save();
    ctx.translate(r * 0.3, -r * 0.2);
    ctx.rotate(aim);

    // 弹弓柄
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.8, 0);
    ctx.stroke();

    // Y形叉
    ctx.beginPath();
    ctx.moveTo(r * 0.8, 0);
    ctx.lineTo(r * 1.0, -r * 0.4);
    ctx.moveTo(r * 0.8, 0);
    ctx.lineTo(r * 1.0, r * 0.4);
    ctx.stroke();

    // 弹性绳索
    ctx.strokeStyle = '#a08060';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 1.0, -r * 0.4);
    ctx.quadraticCurveTo(r * 0.6 - pull, 0, r * 1.0, r * 0.4);
    ctx.stroke();

    // 石块（发射时显示）
    if (v.strike > 0 || v.recoil > 0) {
      ctx.fillStyle = '#7a6a5a';
      ctx.beginPath();
      ctx.arc(r * 0.6 - pull, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },
});
