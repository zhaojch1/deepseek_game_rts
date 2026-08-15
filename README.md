# DeepSeek Game RTS

网页端二维实时策略（RTS）游戏 —— 第一阶段：出兵系统。运行在浏览器中，玩家扮演指挥官，生产古代冷兵器兵种、框选部队、下达移动与攻击指令，与电脑对手实时对抗。

## 运行

```bash
node server.js
```

然后浏览器打开 `http://localhost:3000` 即可开始对局（默认端口 3000，可用 `PORT` 环境变量覆盖）。

> 零依赖，无需 `npm install`。仅需 Node.js ≥ 18。

## DeepSeek AI（可选）

敌方 AI 分两层：

1. **规则层（保底）**：内置策略周期性生产、集结、进攻、回防，无需任何配置即可游玩。
2. **DeepSeek 指挥官层（增强）**：每 20–30 秒向 DeepSeek 请求一次高层策略，失败/超时自动降级为规则层，不中断游戏。

敌方 AI 采用「指挥态势」状态机，让行为更有层次感：

- **build（发育）** 少量兵力就地扩充
- **rally（集结）** 部队向集结点收拢成松散编队
- **harass（试探）** 小规模骚扰，不投入全部兵力
- **assault（总攻）** 兵力优势时倾巢而出
- **defend（回防）** 基地被入侵时回救
- **retreat（撤退）** 兵力劣势时撤回重整

DeepSeek 返回的 `armyFocus`（兵种倾向）与 `aggression`（进攻倾向）作为「指挥官意志」注入状态机，影响生产侧重、进攻节奏与总攻时机；`attackNow` 可强制提前发动总攻。

启用方式：

```bash
# 复制 .env.example 为 .env 并填入 Key
cp .env.example .env   # Windows: copy .env.example .env
# 编辑 .env，设置 DEEPSEEK_API_KEY=sk-...
node server.js
```

API Key 仅保存在后端，绝不出现在前端。

## 操作

| 按键 | 功能 |
| --- | --- |
| 左键拖拽 | 框选 |
| 左键点击 | 单选 / 点击空白取消 |
| 右键 | 移动 / 攻击指定目标 |
| A + 左键 | 攻击移动 |
| Q / W / E / R | 生产 长矛兵 / 刀盾兵 / 弓箭手 / 骑兵 |
| Shift + 选择 | 追加选择 |
| Esc | 取消选择 |
| 空格 | 视角回到基地 |
| 滚轮 / 方向键 | 缩放 / 平移 |
| F2 | 切换调试面板（AI 决策来源） |

## 目录结构

```
deepseek_game_rts/
├── 需求文档.md
├── README.md
├── package.json
├── server.js                 # 静态服务器 + /api/ai/command 代理
├── .env.example
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── config.js         # 所有平衡数值集中于此
        ├── main.js           # 入口 + 主循环 + 胜负判定
        ├── input.js          # 鼠标/键盘/框选
        ├── camera.js         # 相机与视野
        ├── world.js          # 地图与静态实体
        ├── unit.js           # 单位实体与状态机
        ├── pathfinding.js    # 网格 A* 寻路
        ├── combat.js         # 空间分桶/索敌/克制结算
        ├── production.js     # 经济与生产队列
        ├── ai.js             # 规则 AI + DeepSeek 指挥官
        ├── render.js         # 渲染 + 小地图
        └── ui.js             # HUD/面板/提示
```

## 调参

所有平衡数值（兵种属性、克制倍率、军费增长、基地耐久、AI 节奏等）集中在 `public/js/config.js`，调参无需改动逻辑代码。

---

# 架构与实现逻辑（面向接手者）

> 本文档写给后续接手此项目的 AI 或开发者：说明代码结构、数据流、关键算法与已踩过的坑。改动前请先阅读对应小节。

## 1. 技术栈与约束

- **后端**：Node.js 内置 `http`/`https` 模块，**零依赖**（无 `npm install`）。
- **前端**：HTML5 Canvas 2D + 原生 JS，**无构建步骤**（直接 `<script>` 顺序加载）。
- **全局命名空间**：`window.RTS`，所有模块挂载为 `RTS.xxx`（IIFE 单例）。
- **模块加载顺序**（`index.html` 中严格规定，**不可调换**，因为 `main.js` 的 boot IIFE 依赖所有前置模块已定义）：

```
config → world → pathfinding → camera → unit → combat → production → ai → input → render → ui → main
```

## 2. 全局状态：`RTS.state`

唯一的对局状态对象，由 `main.js` 的 `RTS.Match.createState()` 创建，挂在 `RTS.state`。结构：

```js
RTS.state = {
  time,            // 对局秒数
  phase,           // 'running' | 'victory' | 'defeat' | 'draw'
  fps,             // 由主循环统计
  debugMode,       // true（F2 切换调试面板显示）
  player: Faction, // 己方
  enemy:  Faction, // 敌方
  selection: Set,  // 玩家当前选中的单位 id 集合
  damageNumbers: [], // 飘字数组
  ai: RTS.AI.init(), // AI 内部状态
  orderMarker,     // 最近一次移动/攻击指令的落点标记（渲染淡出）
}

Faction = {
  owner: 'player' | 'enemy',
  gold, goldRate, populationCap,
  base: { x, y, hp, maxHp, radius, owner },
  productionQueue: [ProductionOrder],
  units: Map<id, Unit>,    // 注意是 Map，不是数组
}

// 另外两个模块级全局：
RTS.world  // 由 World.create() 生成，含 walkable Uint8Array + W/H 尺寸
RTS.CONFIG // 平衡常量（config.js）
```

**关键约定**：单位用 `Map<id, Unit>` 存储；遍历单位一律通过 `RTS.Combat.forEachUnit(fn)` 或 `Combat.query(x,y,r)`（空间分桶），**不要直接全量双重循环**。

## 3. 模块职责与关键实现

### server.js（后端）
- 静态文件服务：只允许访问 `public/` 内的文件，`path.normalize` + 前缀校验防目录穿越。
- `POST /api/ai/command`：接收战场摘要 JSON，转发 DeepSeek，返回 `{ok, decision, source}` 或降级 `{ok:false, reason}`。
- `GET /api/health`：返回 `{ok, hasKey, model}`，用于确认 Key 是否加载。
- 读取 `.env`（`loadEnvFile`），Key 只存后端，**绝不出现在前端**。
- 关键参数：`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）、`AI_TIMEOUT_MS`（默认 8000）、**已关闭 thinking/思考模式**。
- `extractJson`：稳健地从模型输出提取 JSON（兼容 markdown 代码块包裹、前后杂文字）。
- `clampDecision`：校验/归一化 `armyFocus`（spear/sword/archer/cavalry）、`aggression`（0-100）、`attackNow`、`comment`。

### config.js（唯一调参处）
所有数值集中于此。**设计值的单位换算**（易踩坑）：

- `range`（兵种射程）是「格」单位 → 实际像素射程 = `range * rangeScale(34)`，经 `RTS.rangePx(type)` 换算。
- `speed`（移速）是「格/秒」→ 实际像素速度 = `speed * speedScale(48)`，在 `Unit.create` 里换算。
- 克制表 `counters`：行=攻击方，列=受击方，值>1 克制、<1 被克制。

### world.js（地图）
- `walkable` 是扁平 `Uint8Array`，索引 `idx = y * W + x`。
- 边界一圈 + 障碍簇（固定种子 1337 的确定性伪随机）+ 基地占位区（`markBaseBlocked`）都标记为不可通行。
- 玩家基地在左侧（x=9 格），敌方在右侧（x=W-9 格），y 居中。
- `nearestWalkablePx(x,y)`：把不可通行的目标点吸附到最近可通行格中心（移动/攻击目标都要先过这个）。

### pathfinding.js（A*）
- 网格 A*，8 方向（斜向 cost 1.4142），带**拐角防穿墙**（斜移时检查两个相邻轴格子）。
- `findPath(start, goal)` 返回世界坐标 waypoint 数组。
- `hasLineOfSight(x1,y1,x2,y2)`：步进采样直线是否全程可通行，供移动平滑用。

### camera.js（相机）
- 世界坐标 ↔ 屏幕坐标：`worldToScreen`/`screenToWorld`（**所有鼠标交互必须走 screenToWorld 反算**）。
- 缩放（滚轮）、平移（方向键 + 鼠标边缘滚动）、`clamp` 限制中心范围。

### unit.js（单位状态机）—— **核心，改动最多的地方**
单位状态：`idle | move | attack | attackMove`。

- **移动**：`orderMove` 算 A* 路径，`moveAlongPath` 每帧朝「前瞻距离(`pathLookahead=420`)内最远的视线可达路点」直行（LOS 平滑转向，避免逐格走锯齿）。
- **卡住检测**：用 0.5s 窗口的**净位移**判断（`stuckTimer`/`stuckRef`/`isStuck`），避免把分离力震荡误判。真正卡住且被敌人挡时，`move` 状态会转 `attackMove` 清障后继续。
- **驻守点（hold）机制**：每个单位有 `holdX/holdY`。出生时=出生点；`orderMove`/`orderAttackMove` 都会更新为目标点。`idle` 状态下的自动索敌是「驻守反击」——先索敌追击，敌人死后归位到 hold 点。这使 AI 集结的部队能保持阵形，不散乱跑满全图。
- **右键移动 = 无条件前进**：`move` 状态途中**不自动索敌**，保证玩家随时可改向/掉头（这是早期 bug 修复的重点）。
- **攻击**：`engage` 在射程内进入前摇（`attackWindup`）→ 前摇结束结算伤害；`attackCooldown` 控制攻速。
- **`attackMove`**：沿途自动索敌（`attackMoveAcquireRadius=280`），到达后落位驻守转 `idle`。

### combat.js（战斗/索敌/分离）
- **空间分桶**：`rebuildHash()` 每帧按 `spatialCellSize=96` 把单位塞进 Map 桶，`query(x,y,r)` 邻域查询，避免 O(n²)。
- **索敌 `acquire(unit, range)`**：返回最近敌方目标，优先单位，其次基地（在 range+baseRadius 内）。
- **伤害结算**：`deliverAttack` = 攻击力 × `RTS.counterMul`（克制，向下取整，最低 1）。攻击基地额外乘 `baseDamageMultiplier=0.6`。
- **单位分离**：`applySeparation` 相邻单位互斥，防堆叠。
- **死亡**：`kill` 从 `faction.units` Map 删除，并从 player 的 `selection` 移除。

### production.js（经济与生产）
- 被动军费：`currentGoldRate(time)` = base(5) + 每 60s +0.5，封顶 10，军费上限 2000。
- 生产队列 FIFO，`queued→training`，训练完成 `spawnUnit`（基地附近随机偏移出生）。
- `usedPop = units.size + productionQueue.length`（**排队也占人口**），人口上限 100。
- 取消：`queued` 全额返还，`training` 返还 50%（`cancel` 函数，目前 UI 未暴露取消入口）。

### ai.js（敌方 AI）—— **双层结构**
1. **规则层（保底）**：高层「指挥态势」状态机 + 低层单位指令。
2. **DeepSeek 指挥官层**：每 20-30s 异步 `fetch('/api/ai/command')` 一次，失败自动降级，不阻塞主循环。

**指挥态势状态机（`PHASE`）**：`build → rally → harass → assault / defend → retreat`，每 0.5s `evaluatePhase()` 评估一次（防高频抖动）：

| 态势 | 进入条件 | 行为 |
| --- | --- | --- |
| build | 兵力 <4 | 就地发育 |
| rally | 兵力 ≥4 但不足以进攻 | 向集结点收拢成编队 |
| harass | 兵力 ≥ `aiHarassThreshold` | 小规模骚扰（投 75% 兵力，留后备）|
| assault | 兵力 ≥ 敌方 `aiAssaultRatio(0.75)` 或达阈值 | 倾巢总攻 |
| defend | 基地附近入侵者 ≥ `aiDefenseIntruders(3)` | 回防迎击 |
| retreat | 兵力 <敌方 `aiRetreatThreshold(0.45)` | 撤回基地重整 |

**DeepSeek 决策如何注入**（`applyDecision`）：
- `armyFocus` → 生产侧重（`decideProductionType` 中指定兵种权重 +20，**远高于规则反制的 +4**，避免被覆盖）。
- `aggression` → 影响总攻阈值、攻击波冷却。
- `attackNow` → 强制提前进入 `assault`（兵力足够）或 `rally`（兵力不足）。

⚠️ **重要**：`requestDeepSeek` 的 payload 里带了 `phase`（当前态势），供模型决策参考。若改 prompt 或字段，注意服务端 `clampDecision` 与前端 `applyDecision` 同步。

### input.js（交互）
- 左键框选/单选/Shift 追加；右键移动/攻击；A+左键攻击移动；Q/W/E/R 生产。
- **注意**：相机平移用方向键，不用 WASD（W 被生产快捷键占用）。空格回基地。
- 多单位移动用 `formationOffsets` 生成松散编队偏移（按矩阵排列）。

### render.js / ui.js
- `render.js`：地形/障碍/基地/单位/血条/选中圈/飘字/指令落点标记/小地图。**裁剪**只画视野内对象。
- `ui.js`：HUD（军费/人口/时间/AI来源）、生产面板、选中信息、toast、结束覆盖层、F2 调试面板（含 AI 态势显示）。

### main.js（主循环）
```
boot(): UI.init → Match.start → Render.init → Input.init
frame(): 固定步长 STEP=1/60 模拟（Production→AI→Combat.rebuildHash→units→separation→checkEnd）
          + 实时渲染 + Input/UI 每帧 update
```
胜负判定 `checkEnd`：任一方基地 hp≤0 即胜/负；20 分钟封顶按「兵力×10 + 基地耐久」判平/胜。

## 4. 已知的设计决策与坑（接手必读）

1. **单位速度/射程的单位换算**：新增兵种或调参时，`config.js` 里 `speed`/`range` 是「格」单位，实际乘法在 `unit.js`/`config.js` 的 scale 处理，别把像素值直接填进去。
2. **右键移动不索敌**是有意的（RTS 语义：移动就是移动，攻击用 A/右键点敌人）。若想让移动单位自动还击，改 `unit.js` 的 `move` 分支，但会破坏「随时改向」体验。
3. **驻守点 hold 机制**依赖 `orderMove/orderAttackMove` 会更新 holdX/holdY；若新加移动指令入口（如补丁/技能），务必同步更新 hold，否则单位会回到错误锚点。
4. **AI 生产决策的权重**：DeepSeek `armyFocus` 权重 `+20` 是刻意远大于规则反制 `+4`，保证指挥官决策优先。调这俩数值会影响「AI 是否听指挥」。
5. **空间分桶必须每帧 rebuild**：`main.js` 主循环里 `Combat.rebuildHash()` 在单位 update 之前调用。若移动了单位但忘了 rebuild，`query`/`acquire` 会漏单位。
6. **`.env` 绝不提交**（`.gitignore` 已排除）。真实 Key 只应存在于云端 `.env`，`.env.example` 是模板。
7. **服务端超时用 8s**（原需求写 5s，实测 flash 冷启动偶发超 5s）。失败走 `degraded` 降级，前端静默转规则 AI。
8. **DeepSeek 只在对局 running 阶段调用**（`maybeRequestDeepSeek` 检查 `phase==='running'`），主菜单/暂停不调用，控成本。

## 5. 如何快速验证（无头模拟）

项目早期用 Node + `vm` 沙盒做无头测试（stub 掉 DOM/fetch/requestAnimationFrame），可复刻此模式验证逻辑而不开浏览器：

```js
// 伪代码：在 vm 沙盒里按顺序加载 config→world→...→ai，然后手动设 RTS.state、
// 驱动 RTS.Production.update / RTS.AI.update / RTS.Unit.update / RTS.Combat.* 逐 STEP 跑
```

要点：`RTS.state` 需手工构造（`Match.createState` 依赖 DOM，纯逻辑测试可手动 mkFaction）；`RTS.world` 需先 `World.create()` + `placeBases()`。

## 6. 需求文档映射（验收对照）

需求文档 `需求文档.md` 的 AC-01 ~ AC-09 大多已实现。**尚未实现/可扩展点**：

- 生产队列的**取消**逻辑已写（`Production.cancel`）但 **UI 未暴露取消按钮**。
- 音效/背景音乐、AI 难度分档、多人联机 —— 需求文档「待确认事项」，未实现。
- 基地「随时间获得轻微防御修正」（R-003）——`baseDefensePerMin` 目前为 0，未启用。
