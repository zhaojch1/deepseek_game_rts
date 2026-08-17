'use strict';

/**
 * 单位定义：医师（healer）—— v16 新增
 * 战场医师：远程治疗友军单位，提升部队持续作战能力。
 * 不会主动攻击敌人，而是治疗周围的友军单位。
 * 脆皮、怕被切入，需要近战保护。
 */

RTS.Units.register({
  id: 'healer',
  name: '医师',
  icon: '💊',
  hotkey: 'P',

  cost: 100,
  hp: 55, // 很脆
  attack: 0, // 不攻击
  range: 4.5, // 治疗射程
  attackInterval: 2.0, // 治疗间隔
  speed: 2.0,
  trainTime: 2.0,
  radius: 11,
  color: '#4a9a4a',
  ranged: true, // 治疗也是远程行为

  tags: ['support', 'infantry', 'healer', 'fragile'],
  bonusVs: {}, // 不攻击，无克制

  // v16：医师特色
  special: {
    // 治疗：治疗周围友军单位
    heal: {
      healAmount: 25, // 每次治疗量
      healInterval: 2.0, // 治疗间隔(秒)
      range: 4.5, // 治疗射程(格)
      description: '治疗周围友军单位，每次恢复25生命'
    },
    // 群体治疗：治疗目标周围的友军
    aoeHeal: {
      splashRadius: 80, // 溅射治疗半径(px)
      splashHealMul: 0.4, // 溅射治疗量为主目标的40%
      description: '治疗会溅射到目标周围友军，恢复40%治疗量'
    },
    // 战地急救：对低生命友军治疗量提升
    emergencyHeal: {
      healthThreshold: 0.3, // 生命低于30%触发
      healBonus: 0.5, // 治疗量+50%
      description: '对生命低于30%的友军治疗量+50%'
    }
  },

  ai: {
    role: 'support',
    weight: 0.7,
    desc: '战场医师：治疗友军，提升持续作战能力',
  },

  doc: '医师（healer）：战场治疗支援单位。生命55（很脆）、攻击0（不攻击）、治疗射程4.5格、治疗间隔2.0s、移速2.0格/s、成本100、训练2.0s。特色能力：1）治疗——每次治疗恢复友军25生命；2）群体治疗——治疗会溅射到目标周围80px内友军，恢复40%治疗量；3）战地急救——对生命低于30%的友军治疗量+50%。不会主动攻击敌人，专注于治疗友军。适合跟随大部队行动，治疗前排肉盾和近战单位；但自身很脆，被刺客或骑兵切入会迅速阵亡，务必放在近战保护的后排位置。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 医师袍（白色为主）
    ctx.fillStyle = '#e8e8e0';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.6, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 十字标志（红十字）
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(-r * 0.15, -r * 0.4, r * 0.3, r * 0.6);
    ctx.fillRect(-r * 0.3, -r * 0.15, r * 0.6, r * 0.3);

    // 治疗法杖（治疗动画）
    const healPulse = (v.strike || v.recoil) * r * 0.5;
    ctx.save();
    ctx.translate(r * 0.4, -r * 0.2);
    
    // 杖身
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.6);
    ctx.lineTo(0, -r * 0.8);
    ctx.stroke();

    // 杖头宝石（治疗时光芒）
    ctx.fillStyle = '#44cc44';
    ctx.beginPath();
    ctx.arc(0, -r * 0.9, r * 0.25 + healPulse * 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    // 治疗光环
    if (v.strike > 0 || v.recoil > 0) {
      ctx.strokeStyle = '#44cc44';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(0, -r * 0.9, r * 0.6 + healPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    ctx.restore();
  },
});
