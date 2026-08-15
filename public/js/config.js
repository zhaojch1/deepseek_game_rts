'use strict';

/**
 * config.js — 全局配置与平衡数值（所有调参集中于此）
 * 本文件最先加载，建立 window.RTS 命名空间。
 */
window.RTS = window.RTS || {};

RTS.CONFIG = {
  // ---------------------------------------------------------------- 地图
  mapWidthTiles: 64,
  mapHeightTiles: 64,
  tileSize: 48, // px / 格
  get worldWidth() {
    return this.mapWidthTiles * this.tileSize;
  },
  get worldHeight() {
    return this.mapHeightTiles * this.tileSize;
  },

  // ---------------------------------------------------------------- 经济
  initialGold: 300,
  baseGoldRate: 5, // 基础 +5/s
  goldRateGrowthPerMin: 0.5, // 每 60s +0.5/s
  goldRateMax: 10, // 封顶 +10/s
  goldCap: 2000,

  // ---------------------------------------------------------------- 人口
  populationCap: 100,

  // ---------------------------------------------------------------- 基地
  baseMaxHp: 6000,
  baseRadius: 64, // 基地占位半径（px），同时也是障碍范围
  baseDefensePerMin: 0.0, // 随时间轻微防御修正（预留）
  baseDamageMultiplier: 0.6, // 基地为坚固建筑，受到武器伤害的减免倍率

  // ---------------------------------------------------------------- 对局时长
  minMatchSeconds: 600, // ≥10 分钟底线
  maxMatchSeconds: 1200, // 20 分钟封顶判平

  // ---------------------------------------------------------------- 单位数值
  // range 为设计数值，乘以 rangeScale 得到世界像素射程
  rangeScale: 34,
  // speed 为设计数值（格/秒），乘以 speedScale 得到世界像素速度
  speedScale: 48,
  // 空闲单位自动防御索敌半径 / 攻击移动索敌半径（世界像素）
  acquireRadius: 220,
  attackMoveAcquireRadius: 280,

  unitTypes: {
    spear: {
      name: '长矛兵',
      cost: 60,
      hp: 110,
      attack: 16,
      range: 1.4,
      attackInterval: 1.2,
      speed: 2.2,
      trainTime: 6,
      radius: 12,
      color: '#4a90d9',
    },
    sword: {
      name: '刀盾兵',
      cost: 70,
      hp: 150,
      attack: 13,
      range: 1.0,
      attackInterval: 1.0,
      speed: 2.0,
      trainTime: 8,
      radius: 13,
      color: '#8a6bd9',
    },
    archer: {
      name: '弓箭手',
      cost: 80,
      hp: 70,
      attack: 13,
      range: 5.5,
      attackInterval: 1.4,
      speed: 2.0,
      trainTime: 9,
      radius: 11,
      color: '#d9a03a',
      ranged: true,
    },
    cavalry: {
      name: '骑兵',
      cost: 120,
      hp: 130,
      attack: 20,
      range: 1.0,
      attackInterval: 1.5,
      speed: 4.2,
      trainTime: 12,
      radius: 14,
      color: '#d95a5a',
    },
  },

  // ---------------------------------------------------------------- 克制（行=攻击方，列=受击方）
  counters: {
    spear: { spear: 1.0, sword: 1.0, archer: 1.0, cavalry: 1.6 },
    sword: { spear: 1.2, sword: 1.0, archer: 1.3, cavalry: 0.8 },
    archer: { spear: 1.0, sword: 0.7, archer: 1.0, cavalry: 1.0 },
    cavalry: { spear: 0.7, sword: 1.1, archer: 1.5, cavalry: 1.0 },
  },

  // ---------------------------------------------------------------- 移动 / 寻路
  unitSeparationDist: 24, // 单位间排斥距离
  formationSpacing: 30, // 编队间距
  repathInterval: 1.5, // 周期性重算路径间隔（秒）
  arriveThreshold: 14, // 判定到达目标的距离
  pathLookahead: 420, // 视线平滑的前瞻距离（px），限制每帧 LOS 采样成本

  // ---------------------------------------------------------------- 战斗
  spatialCellSize: 96, // 空间分桶单元格
  attackWindup: 0.15, // 攻击前摇（秒）
  damageNumberLifetime: 0.9,

  // ---------------------------------------------------------------- 地形（渲染 / 掩体）
  terrainTypes: { grass: 0, water: 1, forest: 2, rock: 3, road: 4 },
  coverRangedMul: 0.7, // 森林掩体：单位在树林中受到远程伤害的倍率

  // ---------------------------------------------------------------- 资源（金 / 木 / 石）
  resourceNodes: {
    gold: { income: 2.2, radius: 110, color: '#f2c14e' },
    wood: { income: 1.4, radius: 110, color: '#7fc97f' },
    stone: { income: 1.0, radius: 110, color: '#9fb0c8' },
  },
  resourceCap: 999, // 木/石上限
  captureSpeed: 0.8, // 占领权重变化 / 秒（需累积到 1 才易主）

  // ---------------------------------------------------------------- 升级
  upgradeMaxLevel: 3,
  upgrades: {
    attack: { name: '军备锻造', resource: 'wood', costs: [120, 220, 340], mul: 0.15 },
    armor: { name: '铁甲研究', resource: 'wood', costs: [100, 180, 280], flat: 2 },
    defense: { name: '城防工事', resource: 'stone', costs: [150, 260, 400], hpBonus: 700, arrowsPerLevel: 1 },
  },

  // ---------------------------------------------------------------- 基地防御（城堡箭塔）
  baseDefenseRange: 300, // 箭塔射程（px）
  baseDefenseDamage: 14, // 单支塔箭基础伤害
  baseDefenseInterval: 1.4, // 每轮箭雨间隔（秒）
  baseDefenseArrows: 2, // 每轮基础箭数
  baseDefenseDamagePerLevel: 0.35, // 每级城防提升的塔箭伤害倍率

  // ---------------------------------------------------------------- 投射物
  arrowSpeed: 540, // 弓箭飞行速度 px/s
  towerArrowSpeed: 470, // 塔箭飞行速度 px/s
  corpseDuration: 0.8, // 死亡动画时长（秒）

  // ---------------------------------------------------------------- AI
  aiDecisionIntervalMin: 20, // DeepSeek 调用间隔下限（秒）
  aiDecisionIntervalMax: 30, // 上限（秒）
  aiRequestTimeoutMs: 5000,
  // 规则 AI 参数
  aiBaseAggression: 45,
  aiFirstAttackTime: 45, // 首次进攻时间（秒）
  aiAttackCooldownMin: 25,
  aiAttackCooldownMax: 45,
  aiArmyThreshold: 10, // 集结到多少兵力发起进攻
  aiDefenseRadius: 560, // 玩家单位进入该范围触发回防
  // AI 高层态势状态机（build/rally/harass/assault/defend/retreat）
  aiRallyPointDist: 260, // 集结点距基地的距离
  aiHarassThreshold: 12, // 兵力达到该值可发起试探
  aiAssaultRatio: 0.75, // 兵力达到敌方该比例或处于优势时总攻
  aiRetreatThreshold: 0.45, // 兵力跌到敌方该比例以下时撤退
  aiDefenseIntruders: 3, // 基地附近入侵者达到该数量触发回防
  aiBuildMaxUnits: 8, // 发育/集结阶段持续生产的兵力上限（超出则该阶段下主要靠集结）

  // ---------------------------------------------------------------- 快捷键
  hotkeys: { spear: 'Q', sword: 'W', archer: 'E', cavalry: 'R' },
  attackMoveKey: 'A',
  spaceCenterKey: 'Space',

  // ---------------------------------------------------------------- 相机
  cameraMinZoom: 0.5,
  cameraMaxZoom: 2.2,
  cameraPanSpeed: 900, // 方向键平移速度 px/s（1x 缩放基准）
  cameraEdgeScroll: 26, // 鼠标贴边滚动像素阈值

  // ---------------------------------------------------------------- 渲染
  renderCullMargin: 80, // 视野外裁剪余量
};

/** 计算某兵种的射程（世界像素） */
RTS.rangePx = function (type) {
  return RTS.CONFIG.unitTypes[type].range * RTS.CONFIG.rangeScale;
};

/** 克制倍率 */
RTS.counterMul = function (attacker, defender) {
  const table = RTS.CONFIG.counters[attacker];
  return table ? table[defender] ?? 1.0 : 1.0;
};
