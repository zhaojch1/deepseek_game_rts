# DeepSeek Game RTS

网页端二维实时策略（RTS）游戏。运行在浏览器中，玩家扮演指挥官，生产古代冷兵器兵种、框选部队、下达移动与攻击指令，占领地图资源点、升级科技，与电脑对手实时对抗。

> 双方 AI 的战略决策**完全由大模型接管**（DeepSeek / 豆包可在主菜单选择）；无 Key / 网络失败时自动降级为极简自动驾驶，游戏始终可玩。游戏内顶部按钮可把玩家部队一键交给 AI 接管。

---

## 快速开始

```bash
node server.js
```

浏览器打开 `http://localhost:3000`（默认端口 3000，可用 `PORT` 覆盖）。零依赖，无需 `npm install`，仅需 Node.js ≥ 18。

打开后先进入**主菜单**：从地图列表选择一张地图（小地图「河谷三路」/ 中地图「广域河谷」/ 大地图「大盆地」），点击「开始游戏」。对局结束可「再来一局」（同图重开）或「主菜单」（返回重新选图）。

### 启用大模型 AI（可选）

```bash
# Windows: copy .env.example .env
cp .env.example .env
# 编辑 .env，设置 DEEPSEEK_API_KEY=sk-...（DeepSeek）与/或 ARK_API_KEY=...（豆包）
node server.js
```

支持两家大模型供应商，主菜单可分别为「玩家 AI」与「敌方 AI」选择模型：

| 供应商 | 环境变量 | 默认模型 |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` |
| 豆包（火山方舟 ARK） | `ARK_API_KEY` | `doubao-seed-2-1-turbo-260628` |

API Key 仅保存在后端，绝不出现在前端。某侧未配置 Key 时，该侧自动进入「降级自动驾驶」。

## 玩法与操作

| 按键 | 功能 |
| --- | --- |
| 左键拖拽 | 框选 |
| 左键点击 | 单选 / 点击空白取消 |
| 右键 | 移动 / 攻击指定目标 |
| 点击己方城堡 + 右键 | 设置单位出生集结点 |
| A + 左键 | 攻击移动 |
| Q / W / E / R / T / Y / U / I / O / P | 生产 长矛兵 / 刀盾兵 / 弓箭手 / 骑兵 / 弩手 / 锤子兵 / 骑射手 / 肉盾 / 斥候 / 建筑师 |
| B | 选中建筑师后进入「建造哨塔」模式（左键放置，Esc 结束） |
| N | 选中建筑师后进入「建造兵营」模式（左键放置，Esc 结束，v10.2） |
| Shift + 选择 | 追加选择 |
| Esc | 取消选择 |
| 空格 | 视角回到基地 |
| 滚轮 / 方向键 | 缩放 / 平移 |
| F2 | 切换调试面板（AI 决策来源） |
| 顶部「AI接管」按钮 | 把玩家部队指挥权交给 AI（再点一次交还） |

> 生产快捷键由各单位定义里的 `hotkey` 字段动态决定，出兵卡片按键盘顺序（Q/W/E/R/T/Y/U/I/O/P）排列，新增单位会自动获得新键位并插入对应位置。
>
> **AI 决策消息**：双方大模型每次决策会显示在屏幕两侧的常驻消息条（玩家 AI 左侧蓝色、敌方 AI 右侧红色），不会一闪而过；每侧最多保留 5 条，超过后最老的一条慢慢淡出。普通消息（占领资源点、训练完成等）不再弹提示。
>
> 主菜单可勾选「开局即由 AI 接管玩家部队」，进入对局立刻进入 AI 指挥模式。
>
> 资源点为**持久控制点**：派部队驻守到易主后，即使离开也持续产出；敌方驻守可反夺。科技升级面板位于屏幕左侧（攻击/护甲/疾行用木材，城防/破城用石料），五条科技线最高均为 5 级。森林为远程减伤掩体，地图中央河流仅桥梁可渡。
>
> **v9 防御哨塔**：建筑师（👷）可建造防御哨塔——选中建筑师按 `B` 再左键指定位置，建筑师抵达后施工数秒立起哨塔（消耗 🪵60 🪨60，每阵营上限 8 座）。哨塔耐久高、会向射程内敌人自动射箭，是可被摧毁的坚固建筑；请把它放在己方资源点、桥头或基地要道上。
>
> **v10.2 兵营（第二出兵点）**：建筑师按 `N` + 左键可建造兵营（🪵150 🪨100，每阵营上限 3 座）。兵营与基地一样可以出兵——**当基地生产队列超过 3 个时，多余的订单从兵营出生**（解决「金币太多但基地生产队列不够」）：下单时若基地队列已有 3 个在排且存在兵营，该订单标记为从兵营出生，训练完成后从兵营门口现身并前往集结点。兵营耐久 1500、占位成障碍、可被摧毁（摧毁后订单回退到基地出生）。AI 在经济强（金币速率高/接近上限）且生产有瓶颈（队列拥堵/人口接近满编）时也会自动建兵营。
>
> **v10 四级指挥链**：双方 AI 由**四个大模型**组成司令部——**主将**（战略意图 3–6s）、**进攻副将**与**防守副将**（把命令翻译成**逐单位**战术命令，4–7s）、**军需官**（生产计划/科技升级/哨塔选址，5–9s）。主将说「抢占资源」，进攻副将就会让 3 个斥候同时奔赴 3 座不同的金矿；军需官按敌方兵种构成反制出兵并决定升级与筑垒位置。副将命令落到单位级「微指令」，微指令占用中的部队不会被其他执行器拽走（防来回横跳）；紧急防守/撤退可强制接管。各角色决策以「【主将】/【进攻副将】/【防守副将】/【军需官】」前缀显示在两侧消息条。

## 核心特性

- **单位 skill 化**：每种单位是 `public/js/units/*.js` 下的自包含定义（数值 + 克制 + 标签 + 绘制 + AI 介绍），运行时走 `RTS.Units` 注册表。当前 10 兵种：长矛兵 / 刀盾兵 / 弓箭手 / 弩手 / 骑兵 / 锤子兵 / 骑射手 / 肉盾 / 斥候 / 建筑师。
- **地图 skill 化**：每张地图是 `public/js/maps/*.js` 下的自包含定义（尺寸 small/medium/large + 基地 + 通道 + 资源 + 地形生成）。当前 3 张：河谷三路（小）、广域河谷（中）、大盆地（大）。
- **大模型完全接管 AI（v10 四级指挥链）**：战略状态（`phase`）100% 来自所选大模型的 `stance`/`attackNow`，连续刷新（每 3–6s）。**主将**只定战略意图并给三名下属下达一句话指令；**进攻副将/防守副将**把意图翻译成逐单位「微指令」（颗粒度下放到每个单位，例如 3 个斥候同时奔赴 3 座不同金矿）；**军需官**制定生产计划、决定升级科技与哨塔选址。39 种指挥态势作为低层执行器的「指令集」兜底。支持 DeepSeek 与豆包两家供应商，主菜单为玩家/敌方分别选择；玩家可随时点顶部按钮把自己的部队交给 AI 接管（AI vs AI），也可在主菜单勾选开局即接管。AI 决策以常驻消息条呈现（玩家左蓝 / 敌方右红，最多 5 条，角色前缀区分）。v9 分队指令（`squad` 字段）兼容保留。
- **资源 / 科技 / 城堡 / 哨塔**：金/木/石三资源 + 持久控制点；攻击/护甲/城防/破城/疾行五线科技（最高 5 级）；城堡四角塔自动射箭守护，可升级；建筑师可在要地建造防御哨塔（v9）。
- **主菜单选图**：开局前选择地图，新增地图自动出现在菜单里。

## 目录结构

```
deepseek_game_rts/
├── 需求文档.md
├── README.md
├── package.json
├── server.js                 # 静态服务器 + /api/ai/command 代理（DeepSeek/豆包）+ 动态读取单位/地图定义
├── .env.example
├── skills/
│   ├── create_unit.md        # ★ 如何新增单位（详细指南 + 模板）
│   └── create_map.md         # ★ 如何新增地图（详细指南 + 模板）
├── tools/
│   └── build_intro.js        # 生成 public/data/{units,maps}.md 介绍文件
└── public/
    ├── index.html
    ├── css/style.css
    ├── data/
    │   ├── units.md          # 生成的单位介绍（供 DeepSeek/人类阅读）
    │   └── maps.md           # 生成的地图介绍
    └── js/
        ├── config.js         # 跨单位/跨地图的平衡数值
        ├── registry.js       # RTS.Units / RTS.Maps 注册表 + 绘制工具库
        ├── units/            # ★ 单位定义（每单位一个文件）
        │   ├── spear.js / sword.js / archer.js / crossbow.js / cavalry.js
        │   ├── hammer.js / horse_archer.js / wall.js   # v8 新增
        │   └── scout.js / architect.js                 # v9 新增（斥候/建筑师）
        ├── maps/             # ★ 地图定义（每地图一个文件）
        │   ├── valley_river.js   # 小地图 64×64
        │   ├── wide_river.js     # 中地图 96×96
        │   └── grand_basin.js    # 大地图 128×128（v8 新增）
        ├── world.js          # 通用地图容器（不含具体地形）
        ├── pathfinding.js    # 网格 A* 寻路
        ├── camera.js         # 相机与视野
        ├── unit.js           # 单位实体/状态机（工厂从注册表取定义）
        ├── combat.js         # 空间分桶/索敌/克制/护甲/掩体/尸体
        ├── production.js     # 经济与生产队列
        ├── resources.js      # 资源占领/木石经济/科技升级/城堡防御
        ├── projectiles.js    # 弓箭/塔箭投射物
        ├── towers.js         # v9 防御哨塔（建筑师建造/自动射箭/销毁）
        ├── barracks.js       # v10.2 兵营（建筑师建造的第二出兵点：队列溢出分担/占位/销毁）
        ├── ai.js             # 指挥官 AI（v10：主将+进攻/防守副将+军需官四级指挥链 + 逐单位微指令 + 39 态兜底执行器）
        ├── input.js          # 鼠标/键盘/框选
        ├── render.js         # 地形/城堡/箭矢/小地图（单位绘制委托给定义）
        ├── ui.js             # HUD/面板/主菜单（由注册表动态生成）
        └── main.js           # 入口 + 主循环 + 胜负判定
```

## 调参

- **跨单位/跨地图的平衡数值**（军费增长、人口、基地耐久、五线科技、AI 节奏、投射物速度、**防御哨塔造价/耐久/射程**、v10 指挥链节奏：主将/副将/军需官调用间隔、微指令时长与订单上限、v10.1 筑垒节奏：检查间隔/建筑师目标/开局门槛、v10.2 兵营：造价/耐久/上限/基地队列溢出阈值（`baseQueueBarracksThreshold`）与 AI 建兵营触发条件（`aiBarracksMinGoldRate`/`aiBarracksCongestionTime` 等））在 `public/js/config.js`。
- **单个单位的数值/克制/标签**在 `public/js/units/<id>.js`。
- **单个地图的尺寸/基地/通道/资源**在 `public/js/maps/<id>.js`。
- 改完单位/地图 `doc` 后运行 `node tools/build_intro.js` 刷新介绍文件。

---

# 架构与实现逻辑（面向接手者）

## 1. 技术栈与约束

- **后端**：Node.js 内置 `http`/`https` 模块，**零依赖**。
- **前端**：HTML5 Canvas 2D + 原生 JS，**无构建步骤**（直接 `<script>` 顺序加载）。
- **全局命名空间**：`window.RTS`，所有模块挂载为 `RTS.xxx`（IIFE 单例）。
- **模块加载顺序**（`index.html` 严格规定，不可调换）：

```
config → registry → units/* → maps/* → world → pathfinding → camera → unit
→ combat → production → resources → projectiles → towers → ai → input → render → ui → main
```

> 新增单位/地图时，把新 `<script>` 加在 `registry.js` 之后、`world.js` 之前即可。

## 2. 全局状态：`RTS.state`

由 `RTS.Match.createState()` 创建，挂在 `RTS.state`。`RTS.state` 为 `null` 表示「主菜单阶段」（未开局）。

```js
RTS.state = {
  time, phase,        // 'running' | 'victory' | 'defeat' | 'draw'
  fps, debugMode,
  player: Faction, enemy: Faction,
  selection: Set,     // 玩家选中单位 id
  selectedBase,       // 'player' 表示选中己方城堡（设置集结点）
  damageNumbers: [], resources: { nodes: [...] }, corpses: [],
  ai: RTS.AI.init(),
  orderMarker,        // 指令落点标记
}

Faction = {
  owner, gold/goldRate, wood/woodRate, stone/stoneRate,
  populationCap, productionQueue: [], units: Map<id, Unit>,
  base: { x, y, hp, maxHp, radius, owner, defenseCooldown, towerFlash[4], rallyX, rallyY },
  upgrades: { attack, armor, defense, siegecraft, mobility },   // 五线科技，每线最高 5 级
}
```

另外两个模块级全局：`RTS.world`（`World.create()` 产物，含 `walkable`/`terrain` 扁平数组 + `W/H/mapId`）、`RTS.CONFIG`。

**关键约定**：单位用 `Map<id, Unit>`；遍历单位一律走 `RTS.Combat.forEachUnit` 或 `Combat.query(x,y,r)`（空间分桶），不要直接双重循环。

## 3. 模块职责

### server.js（后端）

- 静态文件服务（防目录穿越）；`POST /api/ai/command` 代理 DeepSeek 与豆包（按请求 `provider` 字段路由，`side` 决定指挥官身份）；`GET /api/health`。
- 两家供应商的 Key/模型/端点分别来自 `DEEPSEEK_API_KEY`/`ARK_API_KEY` 等环境变量；豆包请求带 `thinking.type=disabled`。
- `loadDefinitions()`：启动时用 Node `vm` 沙箱求值 `units/*.js` 与 `maps/*.js`，得到单位/地图元信息（剥离 `draw`/`generate`），据此**动态生成系统提示**（注入全部单位/地图 `doc`）并动态得到 `VALID_ARMY_FOCUS`——新增内容后 AI 提示与校验自动跟随。
- `extractJson` / `clampDecision`（按 `role` 分支）：主将校验 `armyFocus`（动态单位 id）、`stance`（39 态）、`lane`（top/mid/bottom）、`targetFocus`（base/army/econ）、`aggression`、`attackNow`、`squad`（v9 分队）、`comment` 与三条下属指令；副将校验 `orders[]`（`unitId` 精确单位 / `group+count` 按兵种选人，任务与目标按角色白名单，上限 8 条/30 单位）；军需官校验 `production[]`（≤6 项）、`upgrade`（五线之一）、`towers[]`（≤4 个 spot）。每个角色有独立的系统提示词（`buildSystemPrompt(side, role)`）。

### registry.js（注册表）

- `RTS.Units`：`register/get/has/all/ids/rangePx/counterMul/toDoc`；`counterMul(a,b)` 从攻击方 `bonusVs[b]` 取克制倍率（默认 1.0）。
- `RTS.Maps`：`register/get/activate/current/toDoc`；`current()` 返回 `config.defaultMap` 指定的地图。
- `RTS.Units.drawKit`：通用图元（`PAL`/`tunic`/`tunicDark`/`humanoid`/`mount`），供单位 `draw` 复用。

### units/\*.js 与 maps/\*.js（自包含定义）

详见 `skills/create_unit.md` 与 `skills/create_map.md`。新增单位/地图只加文件 + 一行 `<script>`，底层零改动。

### config.js（跨实体调参）

- `range`/`speed` 是「格」设计值，实际换算在 `RTS.Units.rangePx` 与 `RTS.Unit.create`（`rangeScale=34`/`speedScale=48`）。
- 保留 `terrainTypes`、`resourceNodes`、`captureSpeed`、`upgrades`、`baseDefense*`、`arrowSpeed`/`towerArrowSpeed`、`coverRangedMul`、AI 节奏、`defaultMap` 等。`worldWidth/worldHeight` getter 从 `RTS.world` 动态取值。
- **经济节奏（v7.2）**：`baseGoldRate=20`（基础军费 +20/s）、`goldRateGrowthPerMin=0.5`（每 60s +0.5/s）、`goldRateMax=30`；金矿节点 `resourceNodes.gold.income=10`（每占一个金矿 +10/s）。训练时长在各单位定义 `trainTime` 内，当前为 1s（长矛）/ 1.33s（刀盾）/ 1.5s（弓箭）/ 2s（弩手）/ 2s（骑兵）/ 1.8s（锤子）/ 2s（骑射）/ 2s（肉盾）/ 1.2s（斥候）/ 1.8s（建筑师）。

### world.js（通用地图容器）

- `create(map)`：按定义尺寸建数组 + 调 `map.generate(world)`。
- `placeBases(map)` / `placeResources(map)`：按定义生成基地/资源点。
- 通用查询 `isWalkable/isWalkablePx/terrainAt/nearestWalkablePx/clampPx/markBaseBlocked/baseTowerPositions`，全部从 `RTS.world` 取尺寸；v9 新增 `markTowerBlocked/unmarkTowerBlocked`（哨塔占用/恢复瓦片）。
- 供地图定义使用的落子工具 `setTile/setSym/addBlob`（`setSym`/`addBlob` 左右镜像）。

### pathfinding.js（A*）

8 方向网格 A*，拐角防穿墙；`findPath` 返回世界坐标 waypoints；`hasLineOfSight` 用于路径平滑。

### unit.js（单位实体/状态机）

状态 `idle | move | attack | attackMove`。`Unit.create(owner, typeId, x, y)` 是工厂（从 `RTS.Units.get(typeId)` 取定义）；`typeStats(id)` 即 `RTS.Units.get(id)`。

- **移动**：`followPath(unit, tx, ty, dt)` 朝「前瞻距离内最远的可见路点」直行（LOS 平滑）；`pathGoalX/Y` 记录路径目标，偏离超 `repathTargetDelta` 强制重算。
- **跨障碍绕行**：`engage` 追击走 `seekToward`——直线可达则直追，否则 A* 绕行（解决「卡在河岸边」）。
- **卡住检测**：0.5s 净位移判断；`move` 被敌人挡时转 `attackMove` 清障。
- **驻守点 hold**：idle 自动反击后归位到 `holdX/holdY`，保证 AI 集结阵形。
- **近战 vs 远程**：远程前摇结束 `Projectiles.spawnArrow`（射实体箭），近战 `Combat.deliverAttack`。
- **动画字段**：`animPhase/attackAnim/facingX/aimAngle`（远程瞄准俯仰角）。

### combat.js / production.js / resources.js / projectiles.js

- **combat**：空间分桶；`acquire` 索敌；`applyUnitDamage` 统一「克制 × 森林掩体 − 护甲减伤」；克制经 `RTS.Units.counterMul` 动态取；`kill` 生成尸体。
- **production**：被动军费 + FIFO 队列；`spawnUnit` 从城堡城门出生并 `orderAttackMove` 前往基地 `rallyX/rallyY` 集结点。
- **resources**：资源点持久控制；五线升级（攻击/护甲/城防/破城/疾行）；城堡防御从离目标最近的角塔射塔箭（`towerFlash` 闪光）。
- **projectiles**：实体箭/塔箭，`spawnArrow`/`spawnTowerArrow` 的 `target` 必须是 `{kind, ref}` 包装对象。

### ai.js（指挥官 AI）—— v10 四级指挥链（主将 / 副将 / 军需官，全部为大模型）

v7 起 AI 控制器按阵营参数化：`RTS.AI.init(owner, provider)`，`owner` 为 `'enemy'`（`RTS.state.ai`，敌方）或 `'player'`（`RTS.state.playerAI`，玩家 AI 接管时存在）。所有内部逻辑通过 `mine(ai)`/`theirs(ai)` 取己方/对方阵营，同一套执行器可同时驱动双方（AI vs AI）。

- **v10 司令部架构（四级指挥链）**：
  - **主将 general**（3–6s 一次）：输出 `stance`（战略状态唯一来源）、`aggression`、`lane`、`targetFocus`、`attackNow`，以及给三名下属的一句话指令 `offenseDirective` / `defenseDirective` / `economyDirective`。已移除规则层 `evaluatePhase`。
  - **进攻副将 offense / 防守副将 defense**（4–7s 一次）：拿到主将指令 + 可指挥单位清单（roster，控 token 截断）+ 资源点/入侵者/桥头信息，输出 `orders[]` 逐单位命令：`{task, unitId? 或 group+count, lane?, target?}`。命令在**执行端翻译成每个单位的微指令**——例如 `{task:'capture', group:'scout', count:3, target:'gold'}` 会让 3 个斥候各奔一座不同的金矿（目标按数量分发）。进攻任务：attack/harass/raid/capture/flank/kite/siege/rally；防守任务：hold/defend/intercept/retreat/patrol。
  - **军需官 quartermaster**（5–9s 一次）：输出 `production[]`（生产计划，按顺序逐项计数）、`upgrade`（指定科技线）、`towers[]`（从候选位置 `choke_mid/node_3/base_l…` 里选哨塔选址）。生产/升级/筑垒执行器都优先按军需官决策执行，无计划时回退到旧加权逻辑。
  - 任一角色失败/无 Key：主将降级为极简 `degradedPilot`，副将与军需官不启动，39 态态势执行器作为「参谋部兜底」继续指挥（与 v9 行为兼容）。
- **逐单位微指令（v10 核心，颗粒度下放）**：副将命令落地为 `unit.microOrder = {kind, x, y, radius, nodeId, waypoints, until, source}`（capture/hold/defend/intercept 驻守类、attack/harass/raid/siege/flank/kite/rally 进攻类、retreat/flee 撤退类、patrol 巡逻类）。有微指令的单位被 `microReserved` 标记，`freeUnits`/`recallUnits`/`unitsOfType` 一律排除——普通态势执行器绝不抢副将已下令的部队（杜绝来回横跳）。微指令有效期 `aiMicroOrderLifetime`（25s），到期自动释放；capture 完成（节点已归己方且无敌人）提前释放；紧急防守（基地被大部队入侵）与撤退/重整可**强制接管**微指令单位（清除微指令一起回防/撤离）。玩家手动下令（input.js）也会清除选中单位的微指令。
- **39 态 `PHASE` 是执行器指令集**（`executePhase` 落地为低层指令，只指挥无微指令的单位；v10 新增 4 态）：

| 类别 | 态势 |
| --- | --- |
| 经济 | build / boom / tech / eco_defend / fortify（v9 筑垒：建筑师造哨塔，选址由军需官指定） |
| 侦查 | scout / scout_hold / counter_scout |
| 地图控制 | capture_gold / capture_wood / capture_stone / capture_expand / node_garrison |
| 集结 | rally / rally_hold / reinforce |
| 骚扰 | harass / harass_flank / harass_econ / guerrilla（v10 游击：小股多路骚扰+抢资源） |
| 进攻 | assault_mid / assault_top / assault_bottom / all_in / pincer / feint / siege / sneak（v10 偷家：快速单位绕侧路直取基地）/ hold_line（v10 防线推进：稳步推进并驻守） |
| 防守 | defend / defend_choke / defend_node / counter_attack / fallback / priority_defense（v10 重点防守：守住已占资源点与桥头） |
| 撤退重整 | retreat / regroup / turtle / ambush |

- 大模型决策字段：`armyFocus`（生产侧重，权重 +20）、`aggression`、`stance`（唯一状态来源）、`lane`、`targetFocus`、`attackNow`、`squad`（v9 分队指令，兼容保留）。
- **v10 体验优化**：进攻时远程单位自动站后排（目标点向己方一侧偏移 140px）；军需官计划中「买不起」的兵种被跳过而不是卡死整条生产链；斥候抢到资源后继续驻守到安全（capture 微指令）；远程单位可被副将下令「风筝」（kite，边退边射）；微指令占用 + 命令去抖（`sameMicro`）从根上避免「原地反复移动碰撞」。
- **v10.1 确定性状态机（修复斥候折返 / 补上筑垒节奏）**：
  - **斥候抢占链**：capture 微指令占领完成（节点归己方且安全）后**不再释放回池子**，而是自动续接到「离该单位最近的下一个无主资源点」（优先同类型）——行为变成可预测的确定性状态机「赴矿 → 占领 → 奔赴最近下一矿」，直到无主节点占完才释放；副将与兜底执行器（`captureType`/`captureExpand`/`guerrilla`/`squadCapture`）派出的斥候全部走这条链，不再被 LLM 每轮换目标来回折返。
  - **兜底执行器也设微指令**：`assignSquads` 给被派单位打上 `capture`/`hold`/`raid` 占用标记——态势在 `capture_gold ↔ capture_wood ↔ rally` 间切换时，已到位驻守的单位不会被普通态势拉走（v7.1 只保护「在途」单位，v10.1 连「到位」单位也保护）。
  - **筑垒节奏（不依赖 fortify 态势）**：AI 每 `aiFortifyRhythm`(6s) 检查一次——资源富余（木/石 ≥ 2 倍造价、开局 ≥ `aiArchitectMinTime` 秒、建筑师 < `aiArchitectTarget`）时自动在军需官计划里追加/直接下单建筑师；有闲置建筑师就派去军需官指定选址（或兜底桥头/节点/基地两侧）建塔。主将选 `fortify` 态势只是「加速」而非「必需」——保证双方一定会出建筑师、一定会建哨塔。建筑师被普通态势误派去抢资源/驻守时会被筑垒节奏接管（清除微指令改派建塔）。
- **v10.2 兵营（第二出兵点，确定性节奏）**：
  - 建筑师按 `N` + 左键建造兵营（🪵150 🪨100，上限 3 座/阵营，耐久 1500，占位可被摧毁，`barracks.js` 模块，施工推进在 `Barracks.updateBuilders`，主循环调用）。
  - **队列溢出分担**：`Production.order` 下单时若基地队列 ≥ `baseQueueBarracksThreshold`(3) 且有存活兵营，订单打上 `origin: {kind:'barracks', id}` 标记；`Production.spawnUnit` 按 origin 从兵营门口出生（朝敌方一侧偏移），兵营被摧毁则回退基地出生。
  - **AI 兵营节奏**：经济强（`goldRate ≥ aiBarracksMinGoldRate` 或金币 ≥ `aiBarracksMinGold`）且生产有瓶颈（队列拥堵 ≥ `aiBarracksCongestionTime`、金币 ≥ 上限 75%、或人口 ≥ 85%）时，基建节奏优先派建筑师建兵营（基地两侧/前方候选点）；人口 ≥85% 时 `produce()` 把名额优先让给建筑师（避免人口满后补不上建筑师导致「金币多却建不了兵营」）。
- **v9 规则适配保留**：斥候（`scout`，移速 5.6 全场最快）用于抢资源/侦查：`captureType`/`captureExpand` 优先派快速单位，`scout` 态势优先派斥候；筑垒（`fortify`）：空闲建筑师在军需官指定位置（或兜底候选：桥头/已占节点/基地两侧）自动建造哨塔。
- `attackLanes`/`defendChoke`/`scout` 等均从 `RTS.Maps.current().lanes` 读通道；`decideProductionType` 按单位 `ai.weight`/`tags` 动态加权。

### input.js / render.js / ui.js / main.js

- **input**：框选/单选/右键/攻击移动；生产快捷键由单位 `hotkey` 动态决定；城堡选中 + 右键设集结点；相机方向键平移。玩家 AI 接管时（`RTS.state.playerAI` 存在）屏蔽一切兵种控制输入。
- **render**：地形/城堡（逐塔闪光 + 集结点旗帜）/资源/尸体/箭矢/哨塔（v9，含施工进度条）/小地图；单位绘制委托 `def.draw(ctx, view)`；小地图**惰性构建**（`RTS.world` 就绪后）。
- **ui**：HUD、生产面板（按钮由 `RTS.Units.all()` 动态生成并按键盘顺序排列）、升级面板、选中信息、toast、结束覆盖层、**主菜单**（地图卡片由 `RTS.Maps.all()` 动态生成 + 双方 AI 模型下拉选择 + 「开局即由 AI 接管」勾选 + 顶部 AI 接管按钮）、**AI 决策消息条**（`RTS.UI.aiMessage`：玩家左蓝 / 敌方右红，常驻最多 5 条，超出最老一条淡出；开局/重开时 `clearAIMessages` 清空）。
- **main**：boot 只做 `UI.init → Render.init → Input.init` 并显示主菜单（不自动开局）；主循环 `if (RTS.state)` 守卫，`running` 阶段固定步长 `STEP=1/60` 模拟 + 实时渲染。

**主循环顺序**：`Production → AI → Combat.rebuildHash → Resources.captureUpdate → Resources.incomeUpdate → Resources.baseDefenseUpdate → Towers.updateArchitects → Towers.update → units → Projectiles.update → separation → damageNumbers → corpses → checkEnd`。
**胜负**：任一方基地 hp≤0 即胜/负；20 分钟封顶按「兵力×10 + 基地耐久」判平/胜。

## 4. 常见坑（接手必读）

1. **`range`/`speed` 是「格」单位**，实际像素 = 设计值 × scale，别把像素值直接填进单位定义。
2. **右键移动不索敌**是有意的（移动就是移动，攻击用 A/右键点敌人）。
3. **驻守点 hold** 依赖 `orderMove/orderAttackMove` 更新 `holdX/holdY`；新加移动指令入口务必同步更新 hold。
4. **空间分桶每帧 rebuild**：`Combat.rebuildHash()` 必须在单位 update 之前调用。
5. **投射物目标必须是 `{kind, ref}` 包装对象**：v2 曾把裸单位直接传 `spawnTowerArrow`，导致 `target.ref` 为 undefined、塔箭一出生就消失。
6. **AI 低层指令必须节流**：否则重现「集结后原地反复移动碰撞」。
7. **伤害结算统一走 `Combat.applyUnitDamage`**，才能正确吃到克制/掩体/护甲。
8. **资源点是持久控制点**：易主后离开不回退，仅敌方驻守可反夺。
9. **`.env` 绝不提交**；服务端超时默认 45s（`AI_TIMEOUT_MS` 可覆盖，v10 四角色提示词更长，DeepSeek 慢时可调大）；大模型只在 `phase==='running'` 时调用。
10. **主菜单阶段 `RTS.world`/`RTS.state` 为空**：渲染/输入初始化不要读它们（小地图已改为惰性构建，键盘已加守卫）。
11. **玩家 AI 接管**：`RTS.state.playerAI` 非空即接管，`RTS.AI.updateAll` 每帧同时驱动双方；接管期间 `input.js` 会屏蔽全部兵种控制，出兵/升级按钮也会禁用。
12. **AI 消息条淡出**：超出 5 条时给最老一条加 `fading` 类并等 `transitionend` 后移除（含 2.2s 兜底定时器），**不要同步移除**——否则淡出动画失效，且 `while` 循环会因节点未立即移除而死循环。
13. **不要在普通态势打断在途单位**：新增低层指令入口时按「空闲单位 vs 强制召回」分类（`freeUnits`/`recallUnits`），普通经济/地图控制态势只调动空闲单位，否则会重现「占金矿→换态势→部队被拽回来」的来回横跳。可用 `node tools/ai_commit_test.js` 回归验证。
14. **分队指令与普通态势互斥**：`executeSquad` 锁定的兵种必须从 `freeUnits`/`recallUnits` 中排除（`squadTypeOf`），否则同一支部队会被两个执行器来回拉扯。
15. **哨塔是动态障碍**：建塔/拆塔分别调用 `RTS.World.markTowerBlocked`/`unmarkTowerBlocked`（保存并恢复占用瓦片），否则寻路会穿过哨塔或留下永久死路；哨塔目标 `kind: 'tower'`，伤害结算走 `Combat.hitTower`（坚固建筑减伤）。
16. **v10 微指令占用**：副将命令落地为 `unit.microOrder`，有微指令的单位必须从 `freeUnits`/`recallUnits`/`unitsOfType` 排除（`microReserved`），否则兜底态势执行器会把副将刚派出去的部队拽回来。微指令有 `until` 过期时间（AI 与 `Unit.update` 都会清理）；紧急防守/撤退要接管微指令单位时，先 `RTS.Unit.clearMicro(u)` 再下令。
17. **v10 军需官计划**：`ai.qm.plan` 是消费型队列（下单成功后减 count，归零移除）；新决策会整体替换计划。计划项买不起时跳过而不是卡死生产链。
18. **v10 角色请求门控**：副将/军需官请求在 `ai.deepseekEverActive`（主将成功接管）之前不会发起；无 `fetch` 环境（无头测试）下 `requestRole` 走 `no_fetch` 降级，不抛异常。
19. **v10.2 兵营出生点（origin）**：`Production.order` 在**下单时**按「基地队列 ≥ `baseQueueBarracksThreshold` 且存在存活兵营」决定 `origin`，存进订单；`spawnUnit` 按 origin 从兵营门口出生，兵营被摧毁的订单回退基地。改生产逻辑时注意保持 origin 流转，否则出生点会错乱。
20. **v10.2 人口满时补不上建筑师**：AI 爆兵到人口上限后 `canOrder` 会拒绝任何生产（含建筑师），导致「金币多却建不了兵营/哨塔」——`produce()` 在人口 ≥85% 时优先把名额让给建筑师（`architectNeeded`），改生产逻辑时不要破坏这条路径。

## 5. 扩展指南

新增单位 → 见 [`skills/create_unit.md`](skills/create_unit.md)；新增地图 → 见 [`skills/create_map.md`](skills/create_map.md)。

## 6. 无头验证

项目用 Node + `vm` 沙盒做无头测试（stub 掉 DOM/fetch/requestAnimationFrame）。按加载顺序 `config → registry → units/* → maps/* → world → pathfinding → camera → unit → combat → production → resources → projectiles → towers → ai` 加载，然后 `RTS.Maps.activate(id)` → `World.create/placeBases/placeResources` → 手动构造 `RTS.state`（记得带 `upgrades/wood/stone/resources.nodes/corpses/towers` 字段）→ 逐 STEP 驱动 `Production/AI/Combat.rebuildHash/Resources.captureUpdate/incomeUpdate/baseDefenseUpdate/Towers.updateArchitects/Towers.update/Unit.update/Projectiles.update/Combat.*`。

## 7. 版本历程

- **v2**：资源/科技/城堡防御 + 复杂地图（河流三路）+ 单位动画。
- **v3**：美术打磨（弓箭瞄准/城堡塔箭/集结点）+ AI 状态机扩容 34 态。
- **v4**：单位/地图 skill 化（自包含定义 + 注册表）+ DeepSeek 动态读取定义生成提示与校验 + `tools/build_intro.js` 介绍文件。
- **v5**：训练时间缩短为 1/3 + AI 状态完全由 DeepSeek 接管（连续刷新）。
- **v6**：新增中地图「广域河谷」+ 主菜单地图选择 + 新单位「弩手」。
- **v7**：AI 控制器按阵营参数化（`RTS.AI.init(owner, provider)`）+ 主菜单可选玩家/敌方 AI 大模型（DeepSeek / 豆包）+ 顶部「AI接管」按钮（玩家部队可交给 AI，AI vs AI）+ 出兵卡片按键盘顺序排列 + 服务端超时放宽至 20s。
- **v7.1**：AI 决策消息常驻条（玩家左蓝 / 敌方右红，最多 5 条，超出最老淡出，普通消息不再弹提示）+ 主菜单「开局即由 AI 接管」勾选 + AI 控制精度优化（重复下令去抖、撤退/龟缩强制脱离战斗、集火更精确）。
- **v7.2**：节奏调爽——基础军费 +20/s（每 60s 再 +0.5/s，上限 30）、每个占领金矿 +10/s、全部单位训练时长减半（`public/js/units/*.js` 的 `trainTime`）。
- **v8**：兵种扩至 8 个——新增锤子兵（重锤破甲/攻城）、骑射手（高速风筝）、肉盾（超高生命壁垒），并重做克制矩阵保证无一家独大；新增大型地图「大盆地」（128×128，金8/木12/石14 共 34 资源点）；科技扩为五线（新增破城技术、疾行军），全部科技上限由 3 级提到 5 级，AI 升级策略同步跟进。
- **v9**：AI 分队编队指挥（大模型 `squad` 字段：只命令某个兵种编队，实现「骑兵偷袭侧翼、步兵扛线」的分工，普通态势与分队互不抢单位）+ 兵种扩至 10 个——新增斥候（移速 5.6 全场最快，抢占资源/侦查首选）与建筑师（可在指定位置建造防御哨塔：高耐久、自动射箭、可被摧毁，消耗木/石，新增 `towers.js` 模块 + `fortify` 筑垒态势）+ AI 全面适配新规则（抢资源优先快速单位、斥候侦查、建筑师筑垒、LLM 请求新增哨塔数量）。
- **v10**：AI 重构为**四级指挥链**（全部大模型）——主将（战略意图 + 给下属的一句话指令）/ 进攻副将 / 防守副将（把命令翻译成**逐单位微指令**：如「3 个斥候同时奔赴 3 座不同金矿」，颗粒度从兵种编队下放到每个单位）/ 军需官（生产计划、科技升级、哨塔选址，生产/升级/筑垒执行器按军需官决策执行）；单位新增微指令状态机（capture/hold/defend/intercept/attack/harass/raid/siege/flank/kite/rally/retreat/patrol，微指令占用防拉扯、紧急防守/撤退可强制接管、过期自动释放、玩家手动下令清除）；新增 4 个态势（游击 guerrilla/重点防守 priority_defense/偷家 sneak/防线推进 hold_line，共 39 态）；体验优化（进攻时远程自动站后排、军需官计划买不起的兵种跳过不卡生产链、斥候抢到资源后驻守到安全、远程可风筝、请求体按角色拆分并控 token、F2 调试面板展示指挥链状态）。
- **v10.1**：修复两个实战 bug——① 斥候在大地图「原地打转折返」：capture 微指令改为**抢占链状态机**（占领后自动续接最近的下一个无主资源点，直到占完才释放），兜底执行器 `assignSquads` 也打微指令占用标记（态势切换不再把已到位单位拉走）；② 双方不出建筑师/不建塔：新增**筑垒节奏**（不依赖 fortify 态势，每 6s 检查：资源富余时自动补产建筑师并派闲置建筑师到军需官选址建塔），并让抢占/劫掠/游击类任务排除建筑师（不再被拉去抢矿送死）。
- **v10.2**：新增**兵营**（建筑师按 N 建造，第二出兵点）——**基地生产队列超过 3 个时多余的订单从兵营出生**（解决金币太多但基地队列不够），兵营耐久高、占位可被摧毁，摧毁后订单回退基地；AI 兵营节奏（经济强 + 生产有瓶颈时自动建兵营），人口 ≥85% 时优先补建筑师避免「金币多却建不了兵营」；顺带修复 `World.markTowerBlocked` 漏占圆心瓦片的隐藏 bug（哨塔/兵营中心可能不成为障碍）。
