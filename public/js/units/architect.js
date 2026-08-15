'use strict';

/**
 * 单位定义：建筑师（architect）—— v9 新增
 * 工程兵：不擅长战斗（攻击力极低、身板脆、移速慢），核心能力是——
 * 在所在位置建造「防御哨塔」：选中建筑师按 B + 左键指定位置，
 * 建筑师抵达后开始施工（耗时数秒），完成后原地立起一座会射箭的高耐久哨塔，
 * 建造需消耗木材与石料。克制关系上被任意战斗单位碾压，务必放在己方防线后方施工。
 */

RTS.Units.register({
  id: 'architect',
  name: '建筑师',
  icon: '👷',
  hotkey: 'P',

  cost: 90,
  hp: 100,
  attack: 5, // 仅自卫，几乎打不动人
  range: 1.0,
  attackInterval: 1.5,
  speed: 1.8, // 慢速
  trainTime: 1.8,
  radius: 11,
  color: '#e8b84a',
  ranged: false,

  tags: ['support', 'builder', 'infantry', 'slow', 'fragile'],
  bonusVs: {},

  ai: {
    role: 'builder',
    weight: 0.5,
    desc: '工程兵：在指定位置建造防御哨塔（耗木/石）',
  },

  doc: '建筑师（architect）：工程兵。生命100、攻击5（极低）、近战射程1.0、攻速1.5s、移速1.8格/s（慢）、成本90、训练1.8s。特殊能力：选中后按 B 并左键指定位置，建筑师会走到该处施工（约3.5s）并建造一座防御哨塔——哨塔耐久高、会向射程内的敌人自动射箭，建造消耗木材60与石料60，每阵营最多同时8座。建筑师自身战斗能力几乎为零，被任何兵种克制，务必放在己方阵线后方施工，别让敌人摸到。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 黄色安全帽（区别于其他兵种的金属盔）
    ctx.fillStyle = '#e8b84a';
    ctx.beginPath();
    ctx.arc(r * 0.28, -r * 1.0, r * 0.34, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c9962f';
    ctx.fillRect(r * 0.28 - r * 0.34, -r * 1.06, r * 0.68, r * 0.12);

    // 手持小锤（挥击动画，施工时也可当作工具动画）
    const swing = Math.sin(v.strike * Math.PI) * r * 0.5;
    ctx.save();
    ctx.translate(r * 0.3, -r * 0.25);
    ctx.rotate(-0.4 + swing * 0.8);
    ctx.strokeStyle = kit.PAL.wood;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, r * 0.6);
    ctx.lineTo(r * 0.15, -r * 0.7);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.steel;
    ctx.beginPath();
    ctx.roundRect(-r * 0.15, -r * 0.95, r * 0.62, r * 0.34, r * 0.1);
    ctx.fill();
    ctx.restore();
  },
});
