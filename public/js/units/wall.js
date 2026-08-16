'use strict';

/**
 * 单位定义：肉盾（wall）—— v8 新增
 * 钢铁壁垒：全游戏最高生命的前排纯肉单位，抗线吸收伤害，
 * 手持巨盾克制骑兵冲锋、对弓箭手也有压制；但攻击力极低、移速最慢，
 * 会被锤子兵/弩手这类破甲单位针对，也追不上任何逃跑目标。
 * v11.3：生命大幅提升（320→700）——拆塔/攻基地时是扛塔伤的绝对主力。
 */

RTS.Units.register({
  id: 'wall',
  name: '肉盾',
  icon: '🧱',
  hotkey: 'I',

  cost: 160,
  hp: 700, // v11.3：320→700，真正的钢铁壁垒（扛箭塔/塔伤的主坦克）
  attack: 8, // 攻击力极低
  range: 1.0,
  attackInterval: 1.6,
  speed: 1.5, // 全游戏最慢
  trainTime: 2,
  radius: 15,
  color: '#5a6a5a',
  ranged: false,

  tags: ['melee', 'infantry', 'tank', 'shield', 'frontline', 'heavy', 'slow'],
  bonusVs: { cavalry: 1.3, archer: 1.1, sword: 0.9, spear: 0.8 },

  ai: {
    role: 'wall',
    weight: 1.2, // v11.3：攻城/拆塔语境下提高出场权重（配合 targetFocus=base 加成）
    desc: '钢铁壁垒：超高生命抗线，拆塔/攻基地必须靠它扛伤害',
  },

  doc: '肉盾（wall）：钢铁壁垒型纯肉单位。生命700（全场最高，v11.3 大幅强化）、攻击8（极低）、近战射程1.0、攻速1.6s、移速1.5格/s（全场最慢）、成本160、训练2s。巨盾阵：对骑兵×1.3、对弓箭手×1.1；但对长矛兵×0.8、对刀盾兵×0.9。因攻击低且追不上人，纯粹用于前排抗线吸收伤害、掩护后排输出；拆塔/攻击基地（哨塔1500耐久、基地6000耐久）时是扛伤害的绝对主力，务必搭配锤子兵等输出单位；会被锤子兵（×1.4）与弩手（×1.3）这类破甲单位迅速瓦解，需注意保护。',

  draw(ctx, v) {
    const kit = RTS.Units.drawKit;
    const r = v.r;
    kit.humanoid(ctx, v);

    // 巨型塔盾（几乎覆盖全身，画在人形前方）
    ctx.fillStyle = kit.tunicDark(v.owner);
    ctx.strokeStyle = kit.PAL.metal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-r * 0.1, -r * 1.15, r * 1.05, r * 1.9, r * 0.18);
    ctx.fill();
    ctx.stroke();
    // 盾面铁条
    ctx.strokeStyle = kit.PAL.steel;
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(r * 0.38, -r * 1.0);
    ctx.lineTo(r * 0.38, r * 0.6);
    ctx.moveTo(r * 0.05, -r * 1.0);
    ctx.lineTo(r * 0.05, r * 0.6);
    ctx.stroke();

    // 短剑（戳刺动画）
    const stab = Math.sin(v.strike * Math.PI) * r * 0.5;
    ctx.strokeStyle = kit.PAL.steel;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, -r * 0.15);
    ctx.lineTo(-r * 0.25 - r * 0.85, -r * 0.15 + stab);
    ctx.stroke();
  },
});
