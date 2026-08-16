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
  // v13：全局单位数量硬上限（双方合计，防止极端情况下 CPU 过载）
  globalUnitCap: 250,

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

  // ---------------------------------------------------------------- 编队系统（v12）
  formationSepDist: 42, // v12：编队内单位间理想间距（px，比原 unitSeparationDist 大，保证队形不挤）
  formationSepPush: 0.65, // v12：编队排斥力系数（0-1，越大推力越强；0.65 在推开与不抖动之间平衡）
  formationCohesionRadius: 280, // v12：编队凝聚力半径（px）——单位离编队质心超过此距离时，额外加速归队
  formationIdleDriftSpeed: 0.35, // v12：空闲单位向编队理想位置漂移的速度系数（0-1，低速平稳归位）
  formationRangedOffset: 130, // v12：远程单位在编队中相对前线的后退距离（px），保持远程在近战身后
  formationCavalryFlank: 160, // v12：骑兵在编队中的侧翼展开距离（px），骑兵不堆在正面
  formationArriveStagger: 0.55, // v12：编队到达目标时的随机延迟系数（0-1，防止全部同时抵达堆叠）
  formationRoleSepMul: 2.2, // v12：不同角色（近战/远程/骑兵）单位间的额外分离倍率（保持兵种分层）

  // ---------------------------------------------------------------- 战斗
  spatialCellSize: 96, // 空间分桶单元格
  attackWindup: 0.15, // 攻击前摇（秒）
  damageNumberLifetime: 0.9,

  // ---------------------------------------------------------------- v12 远程自动风筝
  autoKiteRangeMul: 0.50, // 远程单位自动后退的触发距离（射程比例）——近战进入射程 50% 以内即触发后退
  autoKiteSpeedMul: 0.55, // 步兵远程后退速度系数（移速 × 该值）
  autoKiteSpeedMulCav: 0.75, // 骑射后退速度系数（更快，马上射箭）

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
  // v11.3：基地大幅强化——重装炮台（30 伤害/箭 × 3 箭齐射、1.0s 攻速、射程 360），
  // 被围时能有效反打；但要拆还是要出动攻城单位，别让脆皮部队白送。
  baseDefenseRange: 360, // 箭塔射程（px，v11.3：300→360）
  baseDefenseDamage: 30, // 单支塔箭基础伤害（v11.3：14→30）
  baseDefenseInterval: 1.0, // 每轮箭雨间隔（秒，v11.3：1.4→1.0 攻速提升）
  baseDefenseArrows: 3, // 每轮基础箭数（v11.3：2→3 一次齐射 3 支）
  baseDefenseDamagePerLevel: 0.25, // 每级城防提升的塔箭伤害倍率（v11.3：0.3→0.25，基础高了防后期过强）
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
  // v11.1：哨塔大幅强化——重装防御塔（高耐久 1500、射程 400、一次两箭），
  // 拆塔需要攻城武器/集火，建塔才有意义；AI 才有动力广泛布塔。
  towerBuildCost: { wood: 100, stone: 100 }, // 建造哨塔消耗的木材/石料（v11.1：60→100，与强度匹配）
  towerBuildTime: 3.5, // 建造时长（秒）
  towerMaxHp: 1500, // 哨塔耐久（v11.1：420→1500，≈兵营耐久的重装防御塔）
  towerRadius: 30, // 哨塔占位半径（px，同时是障碍范围）
  towerDamageMultiplier: 0.85, // 哨塔为坚固建筑，受到武器伤害的减免倍率
  towerDefenseRange: 400, // 哨塔射箭范围（px，v11.1：290→400，覆盖大片防线）
  towerDefenseDamage: 30, // 单支塔箭伤害（v11.1：13→30）
  towerDefenseInterval: 1.4, // 每轮箭雨间隔（秒，v11.1：1.6→1.4）
  towerDefenseArrows: 2, // 每轮箭数（v11.1：1→2，一次两箭齐射）
  towerFlash: 0.3, // 塔顶闪光时长（秒）
  towerBuildRadius: 26, // 建筑师判定「到达建造点」的距离（px）
  maxTowersPerFaction: 8, // 每阵营哨塔数量上限（防止无限铺塔）

  // ---------------------------------------------------------------- 基地修复（v11.1：基地被摧毁后由建筑师重建）
  baseRepairCost: { wood: 300, stone: 300 }, // 修复一座被摧毁基地消耗的木材/石料
  baseRepairTime: 8, // 修复施工时长（秒）
  baseRepairHpRatio: 0.5, // 修复完成后基地耐久恢复到 maxHp 的比例
  baseRepairRadius: 60, // 建筑师判定「到达修复点」的距离（px）

  // ---------------------------------------------------------------- 生产并发（v11.2）
  // 多基地/多兵营下可同时生产多个部队：队列前 productionConcurrencyMax 个订单并行训练，
  // 超出部分排队等待空出的训练槽。每个订单各自从自己的出生点（origin）出生。
  productionConcurrencyMax: 5, // 每阵营最多同时训练的单位数（同时生产 5 种/个部队）

  // ---------------------------------------------------------------- 兵营（v10.2：建筑师建造的第二出兵点）
  barracksBuildCost: { wood: 150, stone: 100 }, // 建造兵营消耗的木材/石料
  barracksBuildTime: 5, // 建造时长（秒）
  barracksMaxHp: 1500, // 兵营耐久（重要生产建筑，耐久高）
  barracksRadius: 30, // 兵营占位半径（px，同时是障碍范围）
  barracksDamageMultiplier: 0.85, // 兵营为坚固建筑，受到武器伤害的减免倍率
  barracksBuildRadius: 26, // 建筑师判定「到达建造点」的距离（px）
  maxBarracksPerFaction: 3, // 每阵营兵营数量上限
  baseQueueBarracksThreshold: 3, // 基地生产队列超过该数量时，多余的订单从兵营出生
  barracksSpawnOffset: 42, // 单位从兵营出生的偏移（兵营半径 + 该值，px）

  // ---------------------------------------------------------------- 投射物
  arrowSpeed: 540, // 弓箭飞行速度 px/s
  towerArrowSpeed: 470, // 塔箭飞行速度 px/s
  corpseDuration: 0.8, // 死亡动画时长（秒）

  // ---------------------------------------------------------------- AI
  // v10：四级指挥链（主将/进攻副将/防守副将/军需官，全部为大模型）
  // v11：主将决策频率降至约 20s 一次（原 3-6s）——战略意图低频稳定，避免「朝令夕改」
  //      导致部队中途折返；副将（4-7s）与军需官（5-9s）决策频率保持不变。
  aiDecisionIntervalMin: 18, // 主将调用间隔下限（秒，v11：约 20s 一次）
  aiDecisionIntervalMax: 22, // 主将调用间隔上限（秒，v11：约 20s 一次）
  aiOfficerIntervalMin: 4, // 副将（进攻/防守）调用间隔下限（秒，v10）
  aiOfficerIntervalMax: 7, // 副将调用间隔上限（秒，v10）
  aiQuartermasterIntervalMin: 5, // 军需官调用间隔下限（秒，v10）
  aiQuartermasterIntervalMax: 9, // 军需官调用间隔上限（秒，v10）
  aiOfficerRosterCap: 36, // 副将请求中携带的可指挥单位清单上限（控 token）
  aiMaxOrdersPerOfficer: 8, // 每个副将单次最多下达的命令条数
  aiMaxUnitsPerOrder: 10, // 单条 group 命令最多指挥的单位数
  aiQmPlanCap: 6, // 军需官生产计划最多条目数
  aiQmTowerCap: 4, // 军需官单次最多指定哨塔选址数
  aiMicroOrderLifetime: 25, // 微指令默认有效时长（秒，v10：逐单位指令的驻留时间）
  aiOfficerOrderLifetime: 8, // 副将命令集的有效期（秒，超期不再重复尝试分配）
  aiMicroHoldRadius: 60, // 微指令「驻守/抢占」的归位半径（px，v10）
  aiKiteDistanceMul: 0.7, // 风筝：远程单位后退的触发距离（射程比例，v10）
  // v11：斥候（scout）行为——AI 阵营斥候数量上限 + 占领确认时长 + 反击窗口
  aiMaxScouts: 3, // AI 阵营斥候数量上限（场上+队列；防止「斥候人海冲锋」）
  aiScoutCaptureSettleTime: 4, // 斥候占领完成后等待「完全占领+无敌人」的驻留秒数（v11）
  aiScoutCounterattackWindow: 3, // 斥候被攻击后的反击窗口（秒），窗口外不主动交战（v11）
  // v10.1：筑垒节奏（确定性，不依赖 fortify 态势）
  aiFortifyRhythm: 6, // 筑垒节奏检查间隔（秒）：按需产建筑师 + 派闲置建筑师建塔
  aiArchitectMinTime: 90, // 开局多少秒后才允许自动生产建筑师（前期发育不造）
  aiArchitectTarget: 3, // 保留的建筑师数量目标（v11.1：2→3，广泛布塔 + 修复基地需要更多建筑师）
  // v11.2：哨塔选址节奏——优势（兵力领先）时把塔修到敌方半场桥头当「进攻桥头堡」
  aiTowerFrontArmyLead: 5, // 我方兵力领先该数量视为「优势」：哨塔优先修到敌方一侧桥头
  // v10.2：兵营节奏（确定性）——经济强且基地队列持续拥堵时，建筑师在基地附近建兵营
  aiBarracksMinGold: 800, // 当前金币富余阈值（备选条件）
  aiBarracksMinGoldRate: 45, // 金币产生速率阈值（含金矿）：高于该值视为经济强
  aiBarracksCongestionTime: 10, // 基地队列连续拥堵（≥baseQueueBarracksThreshold 个）达到该秒数才建兵营
  aiBarracksTarget: 1, // 自动建造的兵营数量目标
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
  buildBarracksKey: 'N', // v10.2：选中建筑师后按 N + 左键，在目标位置建造兵营
  spaceCenterKey: 'Space',

  // ---------------------------------------------------------------- 相机
  cameraMinZoom: 0.3, // v14：允许更小缩放比以俯瞰整个地图
  cameraMaxZoom: 3.0, // v14：允许更大缩放比以查看细节
  cameraPanSpeed: 900, // 方向键平移速度 px/s（1x 缩放基准）
  cameraEdgeScroll: 26, // 鼠标贴边滚动像素阈值

  // ---------------------------------------------------------------- 渲染
  renderCullMargin: 80, // 视野外裁剪余量
  // v13：LOD 简化渲染缩放阈值（低于此值时用圆形色块替代完整单位绘制，见 render.js LOD_SIMPLE_ZOOM）
  // v13：地形离屏缓存（render.js buildTerrainCache），水面仍逐帧动画
};
