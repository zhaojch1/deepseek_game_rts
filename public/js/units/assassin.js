'use strict';

/**
 * 单位定义：刺客（assassin）—— v16 新增
 * 暗影杀手：高爆发近战单位，拥有隐身能力，专切后排远程与脆皮目标。
 * 隐身时移速降低但不会被敌方单位自动索敌，现身首次攻击造成暴击伤害。
 * 生命低、怕被AOE或近战围殴，需要精准切入时机。
 */

RTS.Units.register({
  id: 'assassin',
  name: '刺客',
  icon: '🗡️',
  hotkey: 'J',

  cost: 120,
  hp: 80, // 脆皮
  attack: 35, // 高爆发
  range: 1.2,
  attackInterval: 1.8, // 攻速较慢，靠爆发
  speed: 3.2, // 较快但不是最快
  trainTime: 2.5,
  radius: 10,
  color: '#2a2a3a',
  ranged: false,

  tags: ['melee', 'infantry', 'assassin', 'stealth', 'burst', 'flanker', 'fragile'],
  bonusVs: { archer: 2.0, crossbow: 2.0, horse_archer: 1.8, healer: 2.0 },

  // v16：刺客特色
  special: {
    // 隐身：移速降低但不会被自动索敌
    stealth: {
      speedMultiplier: 0.7, // 隐身时移速降低到70%
      detectionRange: 120, // 敌方单位靠近该距离(px)会发现隐身
      description: '隐身移动，不会被敌方自动索敌，靠近敌人会被发现'
    },
    // 暴击：现身首次攻击造成额外伤害
    ambushStrike: {
      damageMultiplier: 2.5, // 现身首次攻击伤害×2.5
      description: '脱离隐身的首次攻击造成2.5倍伤害'
    },
    // 毒刃：攻击附带持续伤害
    poisonBlade: {
      damagePerSecond: 5, // 每秒毒伤
      duration: 3, // 毒伤持续时间
      description: '攻击附带毒伤，每秒5点伤害持续3秒'
    }
  },

  ai: {
    role: 'assassin',
    weight: 0.8,
    desc: '暗影刺客：隐身切入后排，秒杀脆皮远程',
  },

  doc: '刺客（assassin）：暗影杀手型近战单位。生命80（脆）、攻击35（高爆发）、近战射程1.2、攻速1.8s、移速3.2格/s（较快）、成本120、训练2.5s。特色能力：1）隐身——移动时进入隐身状态，不会被敌方单位自动索敌，但移速降低到70%，靠近敌人120px会被发现；2）伏击暴击——脱离隐身的首次攻击造成2.5倍伤害；3）毒刃——攻击附带毒伤，每秒5点伤害持续3秒。克制弓箭手（×2.0）、弩手（×2.0）、骑射手（×1.8）、医师（×2.0）。适合绕后切入敌方远程输出阵型，秒杀脆皮单位；但自身也很脆，被近战围殴或AOE命中会迅速阵亡，需要精准把握切入时机。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    
    // 隐身时半透明
    const isStealth = v.u && v.u._stealth;
    if (isStealth) {
      ctx.globalAlpha = 0.4;
    }
    
    kit.humanoid(ctx, v);

    // 披风（暗色）
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.3);
    ctx.lineTo(-r * 0.9, r * 0.6);
    ctx.lineTo(-r * 0.2, r * 0.7);
    ctx.closePath();
    ctx.fill();

    // 双匕首（交叉挥砍动画）
    const slash = (v.strike || v.recoil) * r * 0.7;
    ctx.save();
    ctx.translate(r * 0.2, -r * 0.15);
    
    // 左匕首
    ctx.strokeStyle = '#8a8a9a';
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.8 + slash, -r * 0.4);
    ctx.stroke();
    ctx.fillStyle = '#a0a0b0';
    ctx.beginPath();
    ctx.moveTo(r * 0.7 + slash, -r * 0.45);
    ctx.lineTo(r * 1.1 + slash, -r * 0.4);
    ctx.lineTo(r * 0.7 + slash, -r * 0.35);
    ctx.closePath();
    ctx.fill();
    
    // 右匕首
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.8 + slash, r * 0.4);
    ctx.stroke();
    ctx.fillStyle = '#a0a0b0';
    ctx.beginPath();
    ctx.moveTo(r * 0.7 + slash, r * 0.35);
    ctx.lineTo(r * 1.1 + slash, r * 0.4);
    ctx.lineTo(r * 0.7 + slash, r * 0.45);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
    
    // 恢复透明度
    if (isStealth) {
      ctx.globalAlpha = 1.0;
    }
  },
});
