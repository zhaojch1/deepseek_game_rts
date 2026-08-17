'use strict';

/**
 * 单位定义：狂战士（berserker）—— v16 新增
 * 狂暴战士：高攻低防的近战狂暴单位，越战越强。
 * 生命越低攻击力越高，击杀敌人后恢复生命并短暂提升攻速。
 * 适合混战收割，但怕被远程集火或控制技能针对。
 */

RTS.Units.register({
  id: 'berserker',
  name: '狂战士',
  icon: '⚔️',
  hotkey: 'L',

  cost: 110,
  hp: 120,
  attack: 18, // 基础攻击力
  range: 1.1,
  attackInterval: 1.0, // 攻速快
  speed: 2.4, // 较快
  trainTime: 2.0,
  radius: 13,
  color: '#8a2a2a',
  ranged: false,

  tags: ['melee', 'infantry', 'berserker', 'shock', 'flanker'],
  bonusVs: { sword: 1.2, hammer: 1.1, wall: 0.8, spear: 0.9 },

  // v16：狂战士特色
  special: {
    // 狂暴：生命越低攻击力越高
    rage: {
      maxAttackBonus: 0.8, // 最高+80%攻击力
      healthThreshold: 0.3, // 生命低于30%时达到最大加成
      description: '生命越低攻击力越高，最高+80%'
    },
    // 嗜血：击杀敌人恢复生命并提升攻速
    bloodthirst: {
      healOnKill: 40, // 击杀恢复40生命
      attackSpeedBonus: 0.3, // 击杀后攻速+30%
      buffDuration: 5, // 增益持续时间
      description: '击杀敌人恢复40生命，攻速+30%持续5秒'
    },
    // 战吼：周围有友军时获得攻击力加成
    warCry: {
      radius: 150, // 战吼范围(px)
      attackBonusPerAlly: 0.05, // 每个友军+5%攻击力
      maxBonus: 0.25, // 最高+25%
      description: '周围有友军时获得攻击力加成，每个友军+5%，最高+25%'
    }
  },

  ai: {
    role: 'shock',
    weight: 0.9,
    desc: '狂暴战士：越战越强，适合混战收割',
  },

  doc: '狂战士（berserker）：狂暴型近战单位。生命120、攻击18（基础）、近战射程1.1、攻速1.0s（快）、移速2.4格/s（较快）、成本110、训练2.0s。特色能力：1）狂暴——生命越低攻击力越高，生命低于30%时达到最高+80%攻击力；2）嗜血——击杀敌人恢复40生命，攻速+30%持续5秒；3）战吼——周围有友军时获得攻击力加成，每个友军+5%，最高+25%。对刀盾兵×1.2、对锤子兵×1.1；但对肉盾×0.8、对长矛兵×0.9。适合混战收割，越打越强；但怕被远程集火（生命不高）或控制技能（眩晕/击退）打断节奏，需要肉盾保护或从侧翼切入。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    
    // 狂暴状态时颜色加深
    const hpRatio = v.u ? (v.u.hp / v.u.maxHp) : 1;
    const isEnraged = hpRatio < 0.5;
    
    kit.humanoid(ctx, v);

    // 狂暴光环（生命低时）
    if (isEnraged) {
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // 双手战斧（挥砍动画）
    const swing = (v.strike || v.recoil) * r * 0.8;
    ctx.save();
    ctx.translate(r * 0.1, -r * 0.2);
    ctx.rotate(-0.5 + swing * 0.9);

    // 斧柄
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.7);
    ctx.lineTo(r * 0.15, -r * 0.9);
    ctx.stroke();

    // 斧头
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.moveTo(r * 0.15, -r * 0.9);
    ctx.quadraticCurveTo(r * 1.0, -r * 0.7, r * 0.8, -r * 0.3);
    ctx.lineTo(r * 0.15, -r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    // 嗜血增益效果
    if (v.u && v.u._bloodthirstBuff) {
      ctx.fillStyle = '#ff0000';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  },
});
