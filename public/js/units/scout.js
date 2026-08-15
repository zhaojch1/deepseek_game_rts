'use strict';

/**
 * 单位定义：斥候（scout）—— v9 新增
 * 极速轻装侦察兵：全场移动速度最快的单位，攻击力与生命都低，
 * 定位是「迅速抢占资源点」与「高速侦查」：先于对方冲到金/木/石节点把控制权拿下，
 * 也适合派去探路、确认敌方动向。一旦被近战粘上几乎必死，务必打完就跑。
 */

RTS.Units.register({
  id: 'scout',
  name: '斥候',
  icon: '🏃',
  hotkey: 'O',

  cost: 60,
  hp: 60, // 脆皮
  attack: 6, // 攻击力极低（主要职责是跑位抢占，不是战斗）
  range: 1.0,
  attackInterval: 1.2,
  speed: 5.6, // 全场最快（骑兵 4.2、骑射手 3.8 都追不上）
  trainTime: 1.2,
  radius: 10,
  color: '#5ac8a8',
  ranged: false,

  tags: ['melee', 'fast', 'scout', 'flanker', 'cheap', 'fragile', 'light'],
  bonusVs: { archer: 1.2 }, // 高速切入脆皮弓箭手略占优

  ai: {
    role: 'scout',
    weight: 0.8,
    desc: '极速斥候：抢资源/侦查首选，别拿去硬拼',
  },

  doc: '斥候（scout）：极速轻装侦察兵。生命60（脆）、攻击6（极低）、近战射程1.0、攻速1.2s、移速5.6格/s（全场最快，骑兵4.2/骑射手3.8均追不上）、成本60、训练1.2s。对弓箭手伤害×1.2。定位是抢占资源点与侦查：移速最快，适合第一时间冲到金/木/石节点把控制权拿下，或高速探路、确认敌方动向；但身板极脆、打不过任何正规部队，务必抢完就跑、避免缠斗。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 轻装：无重甲，画一件短披风
    const bob = v.moving ? Math.sin(v.p) * r * 0.12 : 0;
    ctx.fillStyle = kit.tunicDark(v.owner);
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.3 + bob);
    ctx.lineTo(-r * 0.85, r * 0.5);
    ctx.lineTo(-r * 0.2, r * 0.6);
    ctx.closePath();
    ctx.fill();

    // 细剑（突刺动画）
    const thrust = Math.sin(v.strike * Math.PI) * r * 0.6;
    ctx.strokeStyle = kit.PAL.steel;
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(r * 0.25, -r * 0.2);
    ctx.lineTo(r * 1.5 + thrust, -r * 0.3);
    ctx.stroke();
    ctx.fillStyle = kit.PAL.metal;
    ctx.beginPath();
    ctx.moveTo(r * 1.45 + thrust, -r * 0.3 - r * 0.14);
    ctx.lineTo(r * 1.75 + thrust, -r * 0.3);
    ctx.lineTo(r * 1.45 + thrust, -r * 0.3 + r * 0.14);
    ctx.closePath();
    ctx.fill();
  },
});
