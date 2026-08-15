'use strict';

/**
 * resources.js — 资源占领、木/石经济、升级、基地防御（城堡箭塔）
 *
 * 资源体系（第二阶段）：
 *   - 金币 gold：被动增长 + 金矿节点，用于生产单位。
 *   - 木材 wood：伐木场节点产出，用于攻击/护甲升级。
 *   - 石料 stone：采石场节点产出，用于城防（箭塔）升级。
 * 节点采用「持久控制点」模型：单位驻守推动控制值（-1..1），越过阈值即易主；
 * 易主后即使部队离开也保持归属，只有敌方驻守才能反夺。鼓励地图控制而非一波流。
 */

RTS.Resources = (function () {
  const C = () => RTS.CONFIG;

  // ---------------------------------------------------------------- 升级

  function levelOf(faction, track) {
    return (faction.upgrades && faction.upgrades[track]) || 0;
  }

  function upgradeCost(faction, track) {
    const lvl = levelOf(faction, track);
    const cfg = C().upgrades[track];
    if (lvl >= C().upgradeMaxLevel) return null;
    return cfg.costs[lvl];
  }

  function canUpgrade(faction, track) {
    const cfg = C().upgrades[track];
    const cost = upgradeCost(faction, track);
    if (cost === null) return { ok: false, reason: 'max' };
    if (faction[cfg.resource] < cost) return { ok: false, reason: 'resource' };
    return { ok: true, cost };
  }

  /** 执行升级，成功返回 true */
  function upgrade(faction, track) {
    const check = canUpgrade(faction, track);
    if (!check.ok) return false;
    const cfg = C().upgrades[track];
    faction[cfg.resource] -= check.cost;
    faction.upgrades[track] += 1;

    // 城防升级：基地耐久上限 + 当前耐久同步提升
    if (track === 'defense') {
      const base = faction.base;
      const bonus = cfg.hpBonus;
      base.maxHp += bonus;
      base.hp += bonus;
    }
    return true;
  }

  /** 单位实际攻击力（含攻击升级） */
  function effectiveAttack(unit) {
    const lvl = levelOf(RTS.state[unit.owner], 'attack');
    return unit.attack * (1 + lvl * C().upgrades.attack.mul);
  }

  // ---------------------------------------------------------------- 节点占领

  function captureUpdate(dt) {
    const st = RTS.state;
    if (!st.resources) return;
    const rate = C().captureSpeed * dt;
    const th = C().captureThreshold;

    for (const node of st.resources.nodes) {
      const nearby = RTS.Combat.query(node.x, node.y, node.radius);
      let pc = 0;
      let ec = 0;
      for (const u of nearby) {
        if (u.hp <= 0) continue;
        if (u.owner === 'player') pc++;
        else ec++;
      }

      // 一方独在 → 控制值向该方移动；双方同在（争夺）或无人（已占）→ 保持
      if (pc > 0 && ec === 0) {
        node.control = Math.min(1, node.control + rate);
      } else if (ec > 0 && pc === 0) {
        node.control = Math.max(-1, node.control - rate);
      }

      const prev = node.owner;
      node.owner = node.control >= th ? 'player' : node.control <= -th ? 'enemy' : 'neutral';

      // 归属变化时给玩家反馈
      if (node.owner !== prev) {
        if (node.owner === 'player') {
          RTS.UI && RTS.UI.toast('已占领' + (C().resourceNodes[node.type].label || node.type), 'info');
        } else if (prev === 'player') {
          RTS.UI && RTS.UI.toast('资源点失守：' + (C().resourceNodes[node.type].label || node.type), 'warn');
        }
      }
    }
  }

  function incomeUpdate(dt) {
    const st = RTS.state;
    if (!st.resources) return;
    const cap = C().resourceCap;
    for (const node of st.resources.nodes) {
      if (node.owner !== 'player' && node.owner !== 'enemy') continue;
      const cfg = C().resourceNodes[node.type];
      const faction = st[node.owner];
      if (node.type === 'gold') {
        faction.gold = Math.min(C().goldCap, faction.gold + cfg.income * dt);
      } else {
        faction[node.type] = Math.min(cap, faction[node.type] + cfg.income * dt);
        faction[node.type + 'Rate'] = cfg.income;
      }
    }
    // 汇总各阵营资源速率（供 HUD 显示，含节点加成）
    for (const owner of ['player', 'enemy']) {
      const faction = st[owner];
      let woodRate = 0;
      let stoneRate = 0;
      let goldNodeRate = 0;
      for (const node of st.resources.nodes) {
        if (node.owner !== owner) continue;
        if (node.type === 'wood') woodRate += C().resourceNodes.wood.income;
        else if (node.type === 'stone') stoneRate += C().resourceNodes.stone.income;
        else if (node.type === 'gold') goldNodeRate += C().resourceNodes.gold.income;
      }
      faction.woodRate = woodRate;
      faction.stoneRate = stoneRate;
      faction.goldRate = RTS.Production.currentGoldRate(st.time) + goldNodeRate;
    }
  }

  // ---------------------------------------------------------------- 基地防御

  function towerDamage(lvl) {
    return C().baseDefenseDamage * (1 + lvl * C().baseDefenseDamagePerLevel);
  }

  function baseDefenseUpdate(dt) {
    const st = RTS.state;
    for (const owner of ['player', 'enemy']) {
      const faction = st[owner];
      const base = faction.base;
      if (base.firingFlash > 0) base.firingFlash = Math.max(0, base.firingFlash - dt);
      base.defenseCooldown -= dt;
      if (base.defenseCooldown > 0) continue;

      const lvl = levelOf(faction, 'defense');
      const range = C().baseDefenseRange;
      const candidates = RTS.Combat.query(base.x, base.y, range).filter(
        (u) => u.owner !== owner && u.hp > 0
      );
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => RTS.Unit.distTo(a, base.x, base.y) - RTS.Unit.distTo(b, base.x, base.y));

      const arrows = Math.min(
        C().baseDefenseArrows + lvl * C().upgrades.defense.arrowsPerLevel,
        candidates.length
      );
      base.defenseCooldown = C().baseDefenseInterval;
      base.firingFlash = 0.35;
      for (let i = 0; i < arrows; i++) {
        RTS.Projectiles.spawnTowerArrow(base, candidates[i], towerDamage(lvl));
      }
    }
  }

  return {
    effectiveAttack,
    levelOf,
    upgradeCost,
    canUpgrade,
    upgrade,
    captureUpdate,
    incomeUpdate,
    baseDefenseUpdate,
    towerDamage,
  };
})();
