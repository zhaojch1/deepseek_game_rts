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
