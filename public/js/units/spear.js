'use strict';

/**
 * 单位定义：长矛兵（spear）
 * 自包含的「单位技能」文件：数值 + 克制 + AI 元信息 + 绘制 + 供 DeepSeek 阅读的介绍。
 * v14：增加特色——枪阵防御、反冲锋、长矛刺击
 */

RTS.Units.register({
  id: 'spear',
  name: '长矛兵',
  icon: '🔱',
  hotkey: 'Q',

  cost: 60,
  hp: 110,
  attack: 16,
  range: 1.4, // 格（设计值，创建时乘 rangeScale）
  attackInterval: 1.2,
  speed: 2.2, // 格/秒（创建时乘 speedScale）
  trainTime: 1, // v7.2：训练时长减半
  radius: 12,
  color: '#4a90d9',
  ranged: false,

  tags: ['melee', 'infantry', 'anti-cavalry', 'shield', 'frontline', 'cheap'],
  bonusVs: { cavalry: 1.6 },

  // v14：长矛兵特色
  special: {
    // 方阵：3个以上长矛兵聚集时自动结阵，移速降低但护甲略微增加
    phalanx: {
      radius: 140, // 方阵触发范围
      minCount: 3, // 最少需要3个长矛兵才能结阵
      armorBonus: 0.15, // 结阵时固定护甲加成（15%减伤，不叠加）
      speedPenalty: 0.4, // 结阵时移速降低到60%
      description: '3个以上长矛兵聚集时自动结为方阵：护甲+15%，移速-40%，步调整齐'
    },
    // 反冲锋：对冲锋的骑兵造成额外伤害
    antiCharge: {
      damageMultiplier: 2.0, // 对冲锋骑兵的伤害倍率
      description: '对冲锋中的骑兵造成双倍伤害'
    },
    // 长矛刺击：攻击距离比其他近战远
    longReach: true
  },

  ai: {
    role: 'frontline',
    weight: 1,
    desc: '廉价抗线前排，反骑兵，可组成枪阵',
  },

  doc: '长矛兵（spear）：廉价的前排抗线单位。生命110、攻击16、近战射程1.4（比其他近战远）、攻速1.2s、移速2.2格/s、成本60、训练1s。特色能力：1）方阵——3个以上长矛兵聚集时自动结为方阵：护甲+15%、移速-40%、步调整齐划一（固定加成不叠加）；2）反冲锋——对冲锋中的骑兵造成双倍伤害；3）长矛刺击——攻击距离比其他近战单位远。克制骑兵（对骑兵伤害×1.6），性价比高，适合前期量产与反制敌方骑兵。注意：方阵移速慢，适合防守阵地，不适合追击。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 盾（后臂）
    ctx.fillStyle = kit.tunicDark(v.owner);
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-r * 0.55, -r * 0.15, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 长矛（突刺动画）
    const thrust = Math.sin(v.strike * Math.PI) * r * 0.5;
    const sy = -r * 0.15;
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, sy);
    ctx.lineTo(r * 1.5 + thrust, sy);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.moveTo(r * 1.4 + thrust, sy - r * 0.22);
    ctx.lineTo(r * 1.9 + thrust, sy);
    ctx.lineTo(r * 1.4 + thrust, sy + r * 0.22);
    ctx.closePath();
    ctx.fill();
  },
});
