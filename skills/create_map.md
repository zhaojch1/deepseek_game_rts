# Skill：创建新地图（create_map）

> 用途：在本项目中新增一张地图（小/中/大）。按本文档操作即可，**无需改动任何底层代码**（world.js / ai.js / pathfinding.js / render.js 全部自动适配）。

---

## 一、前置认知

- 每张地图是 `public/js/maps/<id>.js` 下的一个**自包含定义文件**，通过 `RTS.Maps.register({...})` 注册。
- `world.js` 是**通用地图容器**：`World.create(map)` 按定义尺寸建好 `walkable`/`terrain` 两个扁平 `Uint8Array`（初始全为草地=可通行），再调用 `map.generate(world)` 由地图自己画地形。
- 地图只有两种硬性数据：`walkable`（0=不可通行 / 1=可通行）与 `terrain`（地形类型，见下）。寻路只看 `walkable`。
- 基地位置、资源点、进攻通道（`lanes`）都由地图定义提供；AI 的分路进攻/隘口防守/侦查会自动读 `lanes`，无需改 AI 代码。
- 每张地图定义自带 `doc`，`server.js` 启动时读入并注入 DeepSeek 系统提示；`node tools/build_intro.js` 生成 `public/data/maps.md`。

## 二、三步快速上手

1. 复制 `public/js/maps/valley_river.js` → `public/js/maps/<新id>.js`，改字段与 `generate`。
2. 在 `public/index.html` 的 `maps/` 脚本段加一行 `<script src="js/maps/<新id>.js"></script>`。
3. 改 `public/js/config.js` 的 `defaultMap`（或运行时 `RTS.Maps.activate(id)`），运行 `node tools/build_intro.js` 刷新 `maps.md`。

完成后：主菜单自动出现该地图可选，寻路/渲染/小地图/AI 分路自动适配地图尺寸。

## 三、定义字段（完整 schema）

```js
RTS.Maps.register({
  // ---- 标识 ----
  id: 'wide_river',          // 唯一 id
  name: '广域河谷',          // 显示名
  size: 'medium',            // 'small' | 'medium' | 'large'（仅 UI 标签/文档用）

  // ---- 尺寸（tile 数）----
  width: 96,
  height: 96,
  // 约定：small≈64、medium≈96、large≈128（tileSize 固定 48px，见 config.js）

  // ---- 基地位置（tile 坐标，务必左右对称）----
  playerBase: { tx: 12, ty: 48 },
  enemyBase:  { tx: 83, ty: 48 },   // 通常 = (width-1-tx, ty)

  // ---- v11 多基地（可选）：每方多座指挥所 ----
  // 不写时 = 单基地（回退 playerBase/enemyBase）。
  // playerBases/enemyBases 的第一个元素即主基地（bases[0]，faction.base）；
  // 出兵按列表顺序轮转：中基地 → 上基地 → 下基地 → …（同时点三次出兵卡片，
  // 先从中路基地出、再上路、再下路）。每座基地独立集结点/角塔防御/血条，
  // 摧毁敌方全部指挥所才获胜；列表务必左右对称（y 对齐）。
  playerBases: [
    { tx: 12, ty: 48 }, // 中路基地（主基地）
    { tx: 14, ty: 16 }, // 上路基地
  ],
  enemyBases: [
    { tx: 83, ty: 48 }, // 中路基地（主基地）
    { tx: 81, ty: 16 }, // 上路基地
  ],

  // ---- 进攻通道（AI 分路进攻/隘口防守/侦查用）----
  lanes: [
    { id: 'top',    ty: 16, label: '上路' },
    { id: 'mid',    ty: 47, label: '中路' },
    { id: 'bottom', ty: 77, label: '下路' },
  ],
  // ty 是「格」坐标（世界 y 像素 = ty * tileSize）。lane 的 ty 应对齐渡河点中心。

  // ---- 桥梁/渡河点元信息（供介绍文档，AI 也会据此理解）----
  bridges: [
    { id: 'top',    y0: 15, y1: 17 },
    { id: 'mid',    y0: 44, y1: 50 },
    { id: 'bottom', y0: 76, y1: 78 },
  ],

  // ---- 资源点（tile 坐标）----
  resources: [
    { type: 'gold',  tx: 18, ty: 24 },   // type ∈ 'gold' | 'wood' | 'stone'
    { type: 'wood',  tx: 30, ty: 16 },
    { type: 'stone', tx: 40, ty: 34 },
    // ... 建议左右对称；中/大地图资源更多
  ],

  // ---- 供 DeepSeek 阅读的详细中文介绍（必填）----
  doc: '广域河谷（中地图 96×96）……（地形/通道/基地/资源/打法，越全越好）',

  // ---- 地形生成（必填）----
  generate(world) { /* 见下文 */ },
});
```

## 四、`generate(world)` 绘制 API

`world` 是 `{ W, H, walkable, terrain, mapId }`。`walkable`/`terrain` 已初始化为「草地=可通行」，**只需设置非草地的格子**。

可用的落子工具（都在 `RTS.World`）：

| 函数 | 作用 |
| --- | --- |
| `RTS.World.setTile(world, tx, ty, terrainType, walkable)` | 设置单格 |
| `RTS.World.setSym(world, tx, ty, terrainType, walkable)` | 设置单格 + 其**左右镜像格** `(W-1-tx, ty)` |
| `RTS.World.addBlob(world, cx, cy, r, terrainType, walkable)` | 圆形 blob（已左右镜像） |

地形类型（`RTS.CONFIG.terrainTypes`）：

| 常量 | 值 | 含义 | 可通行 |
| --- | --- | --- | --- |
| `grass` | 0 | 草地 | ✅ |
| `water` | 1 | 水域（河流/湖泊） | ❌ |
| `forest` | 2 | 森林（远程减伤掩体） | ✅ |
| `rock` | 3 | 岩石/山脉 | ❌ |
| `road` | 4 | 道路/桥梁 | ✅ |

标准模板（中央河流 + 三座桥）：

```js
generate(world) {
  const W = world.W, H = world.H;
  const G = RTS.CONFIG.terrainTypes;
  const set = (tx, ty, t, w) => RTS.World.setTile(world, tx, ty, t, w);
  const setSym = (tx, ty, t, w) => RTS.World.setSym(world, tx, ty, t, w);
  const addBlob = (cx, cy, r, t, w) => RTS.World.addBlob(world, cx, cy, r, t, w);

  // 1) 边界岩石（必须不可通行，防单位走出地图）
  for (let x = 0; x < W; x++) { set(x, 0, G.rock, false); set(x, H - 1, G.rock, false); }
  for (let y = 0; y < H; y++) { set(0, y, G.rock, false); set(W - 1, y, G.rock, false); }

  // 2) 中央河流（4 格宽）+ 三座桥（桥 = road 可通行）
  const riverX = [46, 47, 48, 49];
  const bridges = [[15, 17], [44, 50], [76, 78]];
  for (let y = 1; y < H - 1; y++) {
    const inBridge = bridges.some((b) => y >= b[0] && y <= b[1]);
    for (const x of riverX) set(x, y, inBridge ? G.road : G.water, inBridge);
  }

  // 3) 中央大道（基地 → 中路桥，主攻通道）
  for (let y = 47; y <= 48; y++)
    for (let x = 13; x <= 45; x++) { set(x, y, G.road, true); set(W - 1 - x, y, G.road, true); }

  // 4) 湖泊 / 山脉 / 森林（都用 addBlob，自带左右镜像）
  addBlob(18, 14, 2, G.water, false);
  addBlob(24, 8, 2, G.rock, false);
  addBlob(20, 34, 3, G.forest, true);
  // ...
}
```

## 五、关键约束（务必遵守）

1. **边界不可通行**：四周一圈必须设为 `rock`（或任何 walkable=false），否则 A* 会把单位带出地图边界。
2. **基地要连得上路**：基地格（`playerBase.tx`）到最近的通道/桥梁之间要留一条可通行的路（road 或草地），否则单位出生后会被基地障碍 + 地形卡死；**多基地时每座基地（含 `playerBases`/`enemyBases` 中的每一座）都要保证可到达对方阵营**（寻路连通），否则成为无法攻克的死角。
3. **左右镜像对称**：资源/地形尽量用 `setSym`/`addBlob` 保证公平；`enemyBase.tx = width-1-playerBase.tx`，多基地时 `enemyBases` 与 `playerBases` 逐座 y 对齐。
4. **`lanes[].ty` 对齐渡河点中心**：`laneY(lane)` 会把 `ty * tileSize` 作为该路的目标 Y，若和桥梁错位，AI 分路推进会撞河。多基地地图建议把各基地放在对应通道的 ty 上（大图三路各一座）。
5. **河流 = water（不可通行），桥 = road（可通行）**：不要在河上漏画桥，否则整图不通、寻路失败。
6. **中/大地图资源要更多**：小图约 8~12 座，中图 14 座左右，大图更多，否则经济撑不起更大战场；**v11：中/大地图请给每方安排足够多的安全区金矿（中图每方≥4、大图每方≥6），保证双方都能快速暴兵**，避免资源被单方垄断。
7. **`doc` 写全**：尺寸/基地坐标（含多基地）/通道/桥梁/资源/地形/打法，DeepSeek 靠它制定分路与占点策略。

## 六、验证清单

1. `node --check public/js/maps/<id>.js`（语法）。
2. 无头加载：`RTS.Maps.activate(id)` 后 `RTS.world = World.create(Maps.current())`，确认 `RTS.world.W/H` 等于定义值。
3. **连通性**：`RTS.Pathfinding.findPath(玩家基地, 敌方基地)` 应返回非空路径（跨河经桥）。
4. **资源点可走**：`World.placeResources(map)` 返回的每个节点 `World.isWalkablePx(node.x, node.y)` 为 true（自动吸附保证）。
5. `node tools/build_intro.js` 刷新 `maps.md`；重启 `node server.js` 确认无「加载定义失败」。

## 七、常见坑

- **忘了边界岩石** → 单位 A* 越界（最常见）。
- **基地格与道路脱节** → 单位从城堡出生后被挡。
- **`lanes.ty` 与桥梁 Y 错位** → AI 分路进攻时对着河面硬走。
- **只用 `setTile` 不用 `setSym`** → 地图左右不对称、不公平。
- **`size` 与实际 `width/height` 不符** → 主菜单标签与地图实际大小不一致。
