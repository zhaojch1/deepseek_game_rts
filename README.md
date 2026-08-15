# DeepSeek Game RTS

网页端二维实时策略（RTS）游戏。运行在浏览器中，玩家扮演指挥官，生产古代冷兵器兵种、框选部队、下达移动与攻击指令，占领地图资源点、升级科技，与电脑对手实时对抗。

> 敌方 AI 的战略决策**完全由 DeepSeek 接管**；无 Key / 网络失败时自动降级为极简自动驾驶，游戏始终可玩。

---

## 快速开始

```bash
node server.js
```

浏览器打开 `http://localhost:3000`（默认端口 3000，可用 `PORT` 覆盖）。零依赖，无需 `npm install`，仅需 Node.js ≥ 18。

打开后先进入**主菜单**：从地图列表选择一张地图（小地图「河谷三路」/ 中地图「广域河谷」），点击「开始游戏」。对局结束可「再来一局」（同图重开）或「主菜单」（返回重新选图）。

### 启用 DeepSeek AI（可选）

```bash
# Windows: copy .env.example .env
cp .env.example .env
# 编辑 .env，设置 DEEPSEEK_API_KEY=sk-...
node server.js
```

API Key 仅保存在后端，绝不出现在前端。未配置 Key 时自动进入「降级自动驾驶」。

## 玩法与操作

| 按键 | 功能 |
| --- | --- |
| 左键拖拽 | 框选 |
| 左键点击 | 单选 / 点击空白取消 |
| 右键 | 移动 / 攻击指定目标 |
| 点击己方城堡 + 右键 | 设置单位出生集结点 |
| A + 左键 | 攻击移动 |
| Q / W / E / R / T | 生产 长矛兵 / 刀盾兵 / 弓箭手 / 骑兵 / 弩手 |
| Shift + 选择 | 追加选择 |
| Esc | 取消选择 |
| 空格 | 视角回到基地 |
| 滚轮 / 方向键 | 缩放 / 平移 |
| F2 | 切换调试面板（AI 决策来源） |

> 生产快捷键由各单位定义里的 `hotkey` 字段动态决定，新增单位会自动获得新键位。
>
> 资源点为**持久控制点**：派部队驻守到易主后，即使离开也持续产出；敌方驻守可反夺。科技升级面板位于屏幕左侧（攻击/护甲用木材、城防用石料）。森林为远程减伤掩体，地图中央河流仅桥梁可渡。

## 核心特性

- **单位 skill 化**：每种单位是 `public/js/units/*.js` 下的自包含定义（数值 + 克制 + 标签 + 绘制 + AI 介绍），运行时走 `RTS.Units` 注册表。当前 5 兵种：长矛兵 / 刀盾兵 / 弓箭手 / 弩手 / 骑兵。
- **地图 skill 化**：每张地图是 `public/js/maps/*.js` 下的自包含定义（尺寸 small/medium/large + 基地 + 通道 + 资源 + 地形生成）。当前 2 张：河谷三路（小）、广域河谷（中）。
- **DeepSeek 完全接管 AI**：战略状态（`phase`）100% 来自 DeepSeek 的 `stance`/`attackNow`，连续刷新（每 3–6s）；34 种指挥态势作为低层执行器的「指令集」。
- **资源 / 科技 / 城堡**：金/木/石三资源 + 持久控制点；攻击/护甲/城防三线科技；城堡四角塔自动射箭守护，可升级。
- **主菜单选图**：开局前选择地图，新增地图自动出现在菜单里。

## 目录结构

```
deepseek_game_rts/
├── 需求文档.md
├── README.md
├── package.json
├── server.js                 # 静态服务器 + /api/ai/command 代理 + 动态读取单位/地图定义
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
        ├── maps/             # ★ 地图定义（每地图一个文件）
        │   ├── valley_river.js   # 小地图 64×64
        │   └── wide_river.js     # 中地图 96×96
        ├── world.js          # 通用地图容器（不含具体地形）
        ├── pathfinding.js    # 网格 A* 寻路
        ├── camera.js         # 相机与视野
        ├── unit.js           # 单位实体/状态机（工厂从注册表取定义）
        ├── combat.js         # 空间分桶/索敌/克制/护甲/掩体/尸体
        ├── production.js     # 经济与生产队列
        ├── resources.js      # 资源占领/木石经济/科技升级/城堡防御
        ├── projectiles.js    # 弓箭/塔箭投射物
        ├── ai.js             # 敌方 AI（DeepSeek 接管 + 34 态执行器）
        ├── input.js          # 鼠标/键盘/框选
        ├── render.js         # 地形/城堡/箭矢/小地图（单位绘制委托给定义）
        ├── ui.js             # HUD/面板/主菜单（由注册表动态生成）
        └── main.js           # 入口 + 主循环 + 胜负判定
```

## 调参

- **跨单位/跨地图的平衡数值**（军费增长、人口、基地耐久、AI 节奏、投射物速度等）在 `public/js/config.js`。
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
→ combat → production → resources → projectiles → ai → input → render → ui → main
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
  upgrades: { attack, armor, defense },
}
```

另外两个模块级全局：`RTS.world`（`World.create()` 产物，含 `walkable`/`terrain` 扁平数组 + `W/H/mapId`）、`RTS.CONFIG`。

**关键约定**：单位用 `Map<id, Unit>`；遍历单位一律走 `RTS.Combat.forEachUnit` 或 `Combat.query(x,y,r)`（空间分桶），不要直接双重循环。

## 3. 模块职责

### server.js（后端）

- 静态文件服务（防目录穿越）；`POST /api/ai/command` 转发 DeepSeek；`GET /api/health`。
- `loadDefinitions()`：启动时用 Node `vm` 沙箱求值 `units/*.js` 与 `maps/*.js`，得到单位/地图元信息（剥离 `draw`/`generate`），据此**动态生成系统提示**（注入全部单位/地图 `doc`）并动态得到 `VALID_ARMY_FOCUS`——新增内容后 AI 提示与校验自动跟随。
- `extractJson` / `clampDecision`：稳健提取并校验 `armyFocus`（动态单位 id）、`stance`（34 态）、`lane`（top/mid/bottom）、`targetFocus`（base/army/econ）、`aggression`、`attackNow`、`comment`。

### registry.js（注册表）

- `RTS.Units`：`register/get/has/all/ids/rangePx/counterMul/toDoc`；`counterMul(a,b)` 从攻击方 `bonusVs[b]` 取克制倍率（默认 1.0）。
- `RTS.Maps`：`register/get/activate/current/toDoc`；`current()` 返回 `config.defaultMap` 指定的地图。
- `RTS.Units.drawKit`：通用图元（`PAL`/`tunic`/`tunicDark`/`humanoid`/`mount`），供单位 `draw` 复用。

### units/\*.js 与 maps/\*.js（自包含定义）

详见 `skills/create_unit.md` 与 `skills/create_map.md`。新增单位/地图只加文件 + 一行 `<script>`，底层零改动。

### config.js（跨实体调参）

- `range`/`speed` 是「格」设计值，实际换算在 `RTS.Units.rangePx` 与 `RTS.Unit.create`（`rangeScale=34`/`speedScale=48`）。
- 保留 `terrainTypes`、`resourceNodes`、`captureSpeed`、`upgrades`、`baseDefense*`、`arrowSpeed`/`towerArrowSpeed`、`coverRangedMul`、AI 节奏、`defaultMap` 等。`worldWidth/worldHeight` getter 从 `RTS.world` 动态取值。

### world.js（通用地图容器）

- `create(map)`：按定义尺寸建数组 + 调 `map.generate(world)`。
- `placeBases(map)` / `placeResources(map)`：按定义生成基地/资源点。
- 通用查询 `isWalkable/isWalkablePx/terrainAt/nearestWalkablePx/clampPx/markBaseBlocked/baseTowerPositions`，全部从 `RTS.world` 取尺寸。
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
- **resources**：资源点持久控制；三线升级；城堡防御从离目标最近的角塔射塔箭（`towerFlash` 闪光）。
- **projectiles**：实体箭/塔箭，`spawnArrow`/`spawnTowerArrow` 的 `target` 必须是 `{kind, ref}` 包装对象。

### ai.js（敌方 AI）—— DeepSeek 完全接管

- **战略状态 100% 由 DeepSeek 决定**：`applyDecision` 把 `decision.stance` 直接写成当前 `phase`；已移除规则层 `evaluatePhase`。
- **连续刷新**：开局立即请求，之后每 `aiDecisionIntervalMin~Max`（默认 3–6s）连续刷新。
- **降级兜底**：仅当 DeepSeek 从未成功（`deepseekEverActive === false`）时走极简 `degradedPilot`（build → rally → all_in，基地受威胁 defend）；一旦接管，规则永不再参与。
- **34 态 `PHASE` 是执行器指令集**（`executePhase` 落地为低层指令，非决策）：

| 类别 | 态势 |
| --- | --- |
| 经济 | build / boom / tech / eco_defend |
| 侦查 | scout / scout_hold / counter_scout |
| 地图控制 | capture_gold / capture_wood / capture_stone / capture_expand / node_garrison |
| 集结 | rally / rally_hold / reinforce |
| 骚扰 | harass / harass_flank / harass_econ |
| 进攻 | assault_mid / assault_top / assault_bottom / all_in / pincer / feint / siege |
| 防守 | defend / defend_choke / defend_node / counter_attack / fallback |
| 撤退重整 | retreat / regroup / turtle / ambush |

- DeepSeek 决策字段：`armyFocus`（生产侧重，权重 +20）、`aggression`、`stance`（唯一状态来源）、`lane`、`targetFocus`、`attackNow`。
- 低层指令**必须节流**（`phaseChanged` + 各 timer），已到位单位跳过，避免「原地反复移动碰撞」。
- `attackLanes`/`defendChoke`/`scout` 等均从 `RTS.Maps.current().lanes` 读通道；`decideProductionType` 按单位 `ai.weight`/`tags` 动态加权。

### input.js / render.js / ui.js / main.js

- **input**：框选/单选/右键/攻击移动；生产快捷键由单位 `hotkey` 动态决定；城堡选中 + 右键设集结点；相机方向键平移。
- **render**：地形/城堡（逐塔闪光 + 集结点旗帜）/资源/尸体/箭矢/小地图；单位绘制委托 `def.draw(ctx, view)`；小地图**惰性构建**（`RTS.world` 就绪后）。
- **ui**：HUD、生产面板（按钮由 `RTS.Units.all()` 动态生成）、升级面板、选中信息、toast、结束覆盖层、**主菜单**（地图卡片由 `RTS.Maps.all()` 动态生成）。
- **main**：boot 只做 `UI.init → Render.init → Input.init` 并显示主菜单（不自动开局）；主循环 `if (RTS.state)` 守卫，`running` 阶段固定步长 `STEP=1/60` 模拟 + 实时渲染。

**主循环顺序**：`Production → AI → Combat.rebuildHash → Resources.captureUpdate → Resources.incomeUpdate → Resources.baseDefenseUpdate → units → Projectiles.update → separation → damageNumbers → corpses → checkEnd`。
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
9. **`.env` 绝不提交**；服务端超时 8s；DeepSeek 只在 `phase==='running'` 时调用。
10. **主菜单阶段 `RTS.world`/`RTS.state` 为空**：渲染/输入初始化不要读它们（小地图已改为惰性构建，键盘已加守卫）。

## 5. 扩展指南

新增单位 → 见 [`skills/create_unit.md`](skills/create_unit.md)；新增地图 → 见 [`skills/create_map.md`](skills/create_map.md)。

## 6. 无头验证

项目用 Node + `vm` 沙盒做无头测试（stub 掉 DOM/fetch/requestAnimationFrame）。按加载顺序 `config → registry → units/* → maps/* → world → pathfinding → camera → unit → combat → production → resources → projectiles → ai` 加载，然后 `RTS.Maps.activate(id)` → `World.create/placeBases/placeResources` → 手动构造 `RTS.state`（记得带 `upgrades/wood/stone/resources.nodes/corpses` 字段）→ 逐 STEP 驱动 `Production/AI/Combat.rebuildHash/Resources.captureUpdate/incomeUpdate/baseDefenseUpdate/Unit.update/Projectiles.update/Combat.*`。

## 7. 版本历程

- **v2**：资源/科技/城堡防御 + 复杂地图（河流三路）+ 单位动画。
- **v3**：美术打磨（弓箭瞄准/城堡塔箭/集结点）+ AI 状态机扩容 34 态。
- **v4**：单位/地图 skill 化（自包含定义 + 注册表）+ DeepSeek 动态读取定义生成提示与校验 + `tools/build_intro.js` 介绍文件。
- **v5**：训练时间缩短为 1/3 + AI 状态完全由 DeepSeek 接管（连续刷新）。
- **v6**：新增中地图「广域河谷」+ 主菜单地图选择 + 新单位「弩手」。
