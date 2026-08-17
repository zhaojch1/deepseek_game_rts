'use strict';

/**
 * 单位定义：攻城车（siege_ram）—— v16 新增
 * 攻城利器：专门攻击建筑的重型单位，对基地和哨塔造成巨额伤害。
 * 移速极慢、不能攻击单位，但对建筑伤害极高。
 * 需要肉盾保护才能安全接近建筑。
 */

RTS.Units.register({
  id: 'siege_ram',
  name: '攻城车',
  icon: '🏗️',
  hotkey: 'M',

  cost: 180,
  hp: 200, // 较高生命
  attack: 0, // 不能攻击单位
  range: 1.5, // 攻击建筑的范围
  attackInterval: 3.0, // 攻速很慢
  speed: 1.2, // 极慢
  trainTime: 3.5,
  radius: 18, // 体积大
  color: '#6a5a4a',
  ranged: false,

  tags: ['siege', 'vehicle', 'anti-building', 'slow', 'heavy'],
  bonusVs: {}, // 不攻击单位

  // v16：攻城车特色
  special: {
    // 攻城：对建筑造成巨额伤害
    siegeDamage: {
      baseDamage: 150, // 对基地伤害
      towerDamage: 200, // 对哨塔伤害
      barracksDamage: 180, // 对兵营伤害
      description: '对建筑造成巨额伤害：基地150、哨塔200、兵营180'
    },
    // 破门：对建筑护甲有额外穿透
    armorPierce: {
      buildingArmorReduction: 0.8, // 无视80%建筑护甲
      description: '无视80%建筑护甲'
    },
    // 需要护卫：不能攻击单位，需要友军保护
    noAntiUnit: true,
    description: '不能攻击单位，只能攻击建筑'
  },

  ai: {
    role: 'siege',
    weight: 0.6,
    desc: '攻城利器：专门摧毁建筑，需要肉盾保护',
  },

  doc: '攻城车（siege_ram）：专门攻击建筑的重型攻城单位。生命200（较高）、攻击0（不能攻击单位）、攻城射程1.5格、攻速3.0s（很慢）、移速1.2格/s（极慢）、成本180、训练3.5s。特色能力：1）攻城——对建筑造成巨额伤害：基地150、哨塔200、兵营180；2）破门——无视80%建筑护甲；3）不能攻击单位，只能攻击建筑。适合搭配肉盾和近战部队推进，专门摧毁敌方基地和哨塔；但移速极慢、不能攻击单位，被敌方近战围殴会迅速阵亡，必须有肉盾保护才能安全接近建筑。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;

    // 攻城车主体（木制车身）
    ctx.fillStyle = '#8a7a5a';
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 0.6, r * 1.6, r * 1.2, r * 0.2);
    ctx.fill();
    ctx.strokeStyle = '#6a5a3a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 车轮
    ctx.fillStyle = '#5a4a3a';
    ctx.beginPath();
    ctx.arc(-r * 0.5, r * 0.7, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.5, r * 0.7, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3a2a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 攻城锤（撞锤动画）
    const ramSwing = Math.sin(v.strike * Math.PI) * r * 0.4;
    ctx.save();
    ctx.translate(r * 0.8, 0);

    // 锤头
    ctx.fillStyle = '#7a6a4a';
    ctx.beginPath();
    ctx.roundRect(-r * 0.3, -r * 0.4, r * 0.6, r * 0.8, r * 0.1);
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 锤头铁皮
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(-r * 0.3, -r * 0.4, r * 0.1, r * 0.8);
    ctx.fillRect(r * 0.2, -r * 0.4, r * 0.1, r * 0.8);

    ctx.restore();

    // 防护顶棚（倾斜木板）
    ctx.fillStyle = '#7a6a4a';
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.6);
    ctx.lineTo(-r * 0.5, -r * 1.0);
    ctx.lineTo(r * 0.5, -r * 1.0);
    ctx.lineTo(r * 0.7, -r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 顶棚斜线纹理
    ctx.strokeStyle = '#6a5a3a';
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      const x = i * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.1, -r * 0.65);
      ctx.lineTo(x + r * 0.1, -r * 0.95);
      ctx.stroke();
    }
  },
});
