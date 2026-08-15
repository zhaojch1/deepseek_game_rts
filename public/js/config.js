'use strict';

/**
 * config.js — 全局平衡数值与常量（所有调参集中于此）
 * 本文件最先加载，建立 window.RTS 命名空间。
 *
 * ⚠️ v4 起：单位定义与地图定义已外置到 js/units/*.js 与 js/maps/*.js，
 * 不再包含于此。本文件只保留「跨单位 / 跨地图」的平衡数值。
 */
window.RTS = window.RTS || {};

RTS.CONFIG = {
  // ---------------------------------------------------------------- 地图
  tileSize: 48, // px / 格（全地图通用）
  defaultMap: 'valley_river', // 默认激活的地图 id
  get worldWidth() {
    return ((RTS.world && RTS.world.W) || 64) * this.tileSize;
  },
  get worldHeight() {
    return ((RTS.world && RTS.world.H) || 64) * this.tileSize;
  },

  // ---------------------------------------------------------------- 经济
  initialGold: 300,
  baseGoldRate: 20, // 基础 +20/s（v7.2：提速，战斗更爽快）
  goldRateGrowthPerMin: 0.5, // 每 60s +0.5/s
  goldRateMax: 30, // 封顶 +30/s（须高于基础值，20 分钟时正好到 30）
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

  // ---------------------------------------------------------------- 单位换算
  // range 为设计数值（格），乘以 rangeScale 得到世界像素射程（见 RTS.Units.rangePx）
  rangeScale: 34,
  // speed 为设计数值（格/秒），乘以 speedScale 得到世界像素速度（见 RTS.Unit.create）
  speedScale: 48,
  // 空闲单位自动防御索敌半径 / 攻击移动索敌半径（世界像素）
  acquireRadius: 220,
  attackMoveAcquireRadius: 280,

  // ---------------------------------------------------------------- 移动 / 寻路
  unitSeparationDist: 24, // 单位间排斥距离
  formationSpacing: 30, // 编队间距
  repathInterval: 1.5, // 周期性重算路径间隔（秒）
  arriveThreshold: 14, // 判定到达目标的距离
  pathLookahead: 420, // 视线平滑的前瞻距离（px），限制每帧 LOS 采样成本
  repathTargetDelta: 80, // 追击/移动目标偏离当前路径目标超过该距离时强制重算路径（px）

  // ---------------------------------------------------------------- 战斗
  spatialCellSize: 96, // 空间分桶单元格
  attackWindup: 0.15, // 攻击前摇（秒）
  damageNumberLifetime: 0.9,

  // ---------------------------------------------------------------- 地形（渲染 / 掩体）
  terrainTypes: { grass: 0, water: 1, forest: 2, rock: 3, road: 4 },
  coverRangedMul: 0.7, // 森林掩体：单位在树林中受到远程伤害的倍率

  // ---------------------------------------------------------------- 资源（金 / 木 / 石）
  resourceNodes: {
    gold: { income: 10, radius: 110, color: '#f2c14e', label: '金矿' }, // v7.2：每个金矿 +10/s
    wood: { income: 2.5, radius: 110, color: '#7fc97f', label: '伐木场' },
    stone: { income: 2.2, radius: 110, color: '#9fb0c8', label: '采石场' },
  },
  resourceCap: 999, // 木/石上限
  captureSpeed: 0.8, // 占领控制值变化 / 秒
  captureThreshold: 0.5, // 控制值越过 ±threshold 即易主（-1..1）

  // ---------------------------------------------------------------- 升级（v8：五线科技，每线最高 5 级）
  upgradeMaxLevel: 5,
  upgrades: {
    attack: { name: '军备锻造', resource: 'wood', costs: [100, 180, 280, 420, 620], mul: 0.12, desc: '全体攻击 +12%/级' },
    armor: { name: '铁甲研究', resource: 'wood', costs: [80, 150, 240, 360, 540], pct: 0.08, desc: '受到伤害 -8%/级' },
    defense: { name: '城防工事', resource: 'stone', costs: [120, 220, 340, 500, 720], hpBonus: 600, arrowsPerLevel: 1, desc: '箭塔+1支/级，耐久+600/级' },
    siegecraft: { name: '破城技术', resource: 'stone', costs: [140, 240, 360, 520, 760], baseMul: 0.10, desc: '对基地伤害 +10%/级' },
    mobility: { name: '疾行军', resource: 'wood', costs: [100, 180, 280, 420, 620], mul: 0.06, desc: '新训练单位移速 +6%/级' },
  },

  // ---------------------------------------------------------------- 基地防御（城堡箭塔）
  baseDefenseRange: 300, // 箭塔射程（px）
  baseDefenseDamage: 14, // 单支塔箭基础伤害
  baseDefenseInterval: 1.4, // 每轮箭雨间隔（秒）
  baseDefenseArrows: 2, // 每轮基础箭数
  baseDefenseDamagePerLevel: 0.3, // 每级城防提升的塔箭伤害倍率（v8：5 级制下调，防后期箭塔过强）
  // 四座角塔相对基地中心的位置（以 baseRadius 为比例的偏移）
  baseTowerOffsets: [
    { dx: -0.85, dy: -0.65 },
    { dx: 0.85, dy: -0.65 },
    { dx: -0.85, dy: 0.65 },
    { dx: 0.85, dy: 0.65 },
  ],
  baseTowerRadius: 0.34, // 角塔半径（baseRadius 比例）
  baseTowerFlash: 0.35, // 塔箭发射时塔顶闪光时长（秒）

  // ---------------------------------------------------------------- 单位出生集结点
  baseSpawnRallyDist: 140, // 默认集结点距城堡的距离（朝敌方一侧，px）
  spawnGateDist: 30, // 单位从城门出生位置（baseRadius + 该偏移，px）

  // ---------------------------------------------------------------- 防御哨塔（v9：建筑师建造）
  towerBuildCost: { wood: 60, stone: 60 }, // 建造哨塔消耗的木材/石料
  towerBuildTime: 3.5, // 建造时长（秒）
  towerMaxHp: 420, // 哨塔耐久（高，防御力强）
  towerRadius: 26, // 哨塔占位半径（px，同时是障碍范围）
  towerDamageMultiplier: 0.85, // 哨塔为坚固建筑，受到武器伤害的减免倍率
  towerDefenseRange: 290, // 哨塔射箭范围（px）
  towerDefenseDamage: 13, // 单支塔箭伤害
  towerDefenseInterval: 1.6, // 每轮箭雨间隔（秒）
  towerDefenseArrows: 1, // 每轮箭数
  towerFlash: 0.3, // 塔顶闪光时长（秒）
  towerBuildRadius: 26, // 建筑师判定「到达建造点」的距离（px）
  maxTowersPerFaction: 8, // 每阵营哨塔数量上限（防止无限铺塔）

  // ---------------------------------------------------------------- 投射物
  arrowSpeed: 540, // 弓箭飞行速度 px/s
  towerArrowSpeed: 470, // 塔箭飞行速度 px/s
  corpseDuration: 0.8, // 死亡动画时长（秒）

  // ---------------------------------------------------------------- AI
  aiDecisionIntervalMin: 3, // DeepSeek 调用间隔下限（秒，v4 连续刷新，随时接管）
  aiDecisionIntervalMax: 6, // 上限（秒）
  aiRequestTimeoutMs: 20000, // 前端参考值；实际超时由服务端 AI_TIMEOUT_MS 决定（默认 20s）
  // 规则 AI 参数
  aiBaseAggression: 45,
  aiFirstAttackTime: 45, // 首次进攻时间（秒）
  aiAttackCooldownMin: 25,
  aiAttackCooldownMax: 45,
  aiArmyThreshold: 10, // 集结到多少兵力发起进攻
  aiDefenseRadius: 560, // 玩家单位进入该范围触发回防
  // AI 高层态势状态机（34 态）
  aiRallyPointDist: 260, // 集结点距基地的距离
  aiHarassThreshold: 12, // 兵力达到该值可发起试探
  aiAssaultRatio: 0.75, // 兵力达到敌方该比例或处于优势时总攻
  aiRetreatThreshold: 0.45, // 兵力跌到敌方该比例以下时撤退
  aiDefenseIntruders: 3, // 基地附近入侵者达到该数量触发回防
  aiBuildMaxUnits: 8, // 发育/集结阶段持续生产的兵力上限
  aiScoutSquad: 2, // 侦查小队人数
  aiTechGoldReserve: 300, // 研发科技时保留的军费
  aiAllInRatio: 1.4, // 兵力达到敌方该比例以上时倾巢一击
  aiPincerArmy: 24, // 钳形夹击所需兵力
  aiChokeRange: 420, // 隘口/桥头防守判定半径
  focusFireRadius: 520, // 围城/集火：该范围内单位直接攻击目标，圈外单位先压上再打
  aiStanceHoldTime: 10, // 态势切换冷却（秒）：非紧急态势在冷却内不重复翻转，防止部队来回横跳

  // ---------------------------------------------------------------- 快捷键
  attackMoveKey: 'A',
  buildTowerKey: 'B', // v9：选中建筑师后按 B + 左键，在目标位置建造防御哨塔
  spaceCenterKey: 'Space',

  // ---------------------------------------------------------------- 相机
  cameraMinZoom: 0.5,
  cameraMaxZoom: 2.2,
  cameraPanSpeed: 900, // 方向键平移速度 px/s（1x 缩放基准）
  cameraEdgeScroll: 26, // 鼠标贴边滚动像素阈值

  // ---------------------------------------------------------------- 渲染
  renderCullMargin: 80, // 视野外裁剪余量
};
