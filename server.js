'use strict';

/**
 * DeepSeek Game RTS — 零依赖后端
 * 职责：
 *  1. 提供 public/ 静态资源（HTML/CSS/JS）
 *  2. 代理 POST /api/ai/command 到 DeepSeek API（敌方 AI 指挥官决策）
 *
 * 运行：node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { URL } = require('url');

// ---------------------------------------------------------------- 配置读取

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (_) {
    /* .env 不存在时忽略 */
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 45000; // v10：四角色提示词更长，默认超时放宽到 45s

// 豆包（火山方舟 ARK）—— v7 新增的第二家大模型供应商
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seed-2-1-turbo-260628';
const ARK_ENDPOINT = process.env.ARK_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// ---------------------------------------------------------------- 单位/地图定义（供 AI 决策用）

/**
 * 读取 public/js/units/*.js 与 public/js/maps/*.js 的定义（单一数据源），
 * 在 Node 沙箱中求值注册调用，得到纯元信息（剥离 draw/generate 函数）。
 * 这样新增单位/地图后，AI 提示与校验字段会自动跟随，无需改动本文件。
 */
function loadDefinitions() {
  const units = new Map();
  const maps = new Map();
  const sandbox = {
    RTS: {
      Units: { register: (def) => { if (def && def.id) units.set(def.id, def); } },
      Maps: { register: (def) => { if (def && def.id) maps.set(def.id, def); } },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  function loadDir(dir) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch (_) { /* 目录不存在 */ }
    for (const f of files) {
      try {
        vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
      } catch (e) {
        console.warn(`[RTS] 加载定义失败 ${f}: ${e.message}`);
      }
    }
  }
  loadDir(path.join(PUBLIC_DIR, 'js', 'units'));
  loadDir(path.join(PUBLIC_DIR, 'js', 'maps'));
  return { units, maps };
}

const DEFS = loadDefinitions();
const VALID_ARMY_FOCUS = Array.from(DEFS.units.keys());

function unitIntro(u) {
  const bonus = Object.entries(u.bonusVs || {}).map(([k, v]) => `${k}×${v}`).join('、') || '无克制';
  const tags = (u.tags || []).join('/');
  const siege = u.baseMul ? ` 攻城[基地×${u.baseMul}]` : '';
  return `${u.id}(${u.name})：生命${u.hp} 攻击${u.attack} 射程${u.range}格 攻速${u.attackInterval}s ` +
    `移速${u.speed}格/s 成本${u.cost} 训练${u.trainTime}s 标签[${tags}] 克制[${bonus}]${siege}。${u.doc || ''}`;
}

function mapIntro(m) {
  const lanes = (m.lanes || []).map((l) => l.label || l.id).join('/');
  const res = (m.resources || []).reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  const resStr = Object.entries(res).map(([k, v]) => `${k}×${v}`).join('、');
  return `${m.id}(${m.name})：尺寸${m.width}×${m.height} ${m.size}图，基地 玩家(${m.playerBase.tx},${m.playerBase.ty}) ` +
    `敌方(${m.enemyBase.tx},${m.enemyBase.ty})，通道[${lanes}]，资源[${resStr}]。${m.doc || ''}`;
}

const UNITS_INTRO = Array.from(DEFS.units.values()).map(unitIntro).join('\n');
const MAPS_INTRO = Array.from(DEFS.maps.values()).map(mapIntro).join('\n');

// ---------------------------------------------------------------- 静态文件

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // 路径安全：禁止逃逸 public/ 目录
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------------------------------------------------------------- JSON 工具

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------- LLM 调用（DeepSeek / 豆包）

/**
 * 从模型返回的 content 中尽量稳健地提取一个 JSON 对象。
 * 兼容被 ```json ... ``` 包裹、或前后夹杂说明文字的情况。
 */
function extractJson(content) {
  if (!content) return null;
  // 去掉 markdown 代码块
  let text = content.replace(/```(?:json)?/gi, '```');
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence) text = fence[1];
  // 尝试直接解析
  try {
    return JSON.parse(text.trim());
  } catch (_) {
    /* 继续降级提取 */
  }
  // 提取首个 { ... } 平衡对象
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

// 与前端 ai.js STANCE_LIST 保持一致的态势白名单
const STANCE_LIST = [
  'build', 'boom', 'tech', 'eco_defend', 'fortify',
  'scout', 'scout_hold', 'counter_scout',
  'capture_gold', 'capture_wood', 'capture_stone', 'capture_expand', 'node_garrison',
  'rally', 'rally_hold', 'reinforce',
  'harass', 'harass_flank', 'harass_econ',
  'assault_mid', 'assault_top', 'assault_bottom', 'all_in', 'pincer', 'feint', 'siege',
  'defend', 'defend_choke', 'defend_node', 'counter_attack', 'fallback',
  'retreat', 'regroup', 'turtle', 'ambush',
  // v10：新增态势
  'guerrilla', 'priority_defense', 'sneak', 'hold_line',
];

// v9：分队（编队）指令的任务白名单——LLM 可只命令某个兵种执行这些任务
const SQUAD_TASK_LIST = ['harass', 'attack', 'defend', 'capture', 'rally', 'retreat'];

// v10：四级指挥链角色
const ROLE_LIST = ['general', 'offense', 'defense', 'quartermaster'];
// 进攻副将可下达的任务 / 目标
const OFFENSE_TASKS = ['attack', 'harass', 'raid', 'capture', 'flank', 'kite', 'siege', 'rally'];
const OFFENSE_TARGETS = ['gold', 'wood', 'stone', 'expand', 'base', 'towers', 'econ', 'rally'];
// 防守副将可下达的任务 / 目标
const DEFENSE_TASKS = ['hold', 'defend', 'intercept', 'retreat', 'patrol'];
const DEFENSE_TARGETS = ['base_own', 'node', 'choke', 'nearest_intruder', 'rally'];
// 军需官可升级的科技线
const UPGRADE_TRACKS = ['attack', 'armor', 'defense', 'siegecraft', 'mobility'];
const LANE_LIST = ['top', 'mid', 'bottom'];

function clampGeneralDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  const armyFocus = VALID_ARMY_FOCUS.includes(decision.armyFocus)
    ? decision.armyFocus
    : null;
  let aggression = Number(decision.aggression);
  if (!Number.isFinite(aggression)) aggression = 50;
  aggression = Math.max(0, Math.min(100, Math.round(aggression)));
  const attackNow = decision.attackNow === true;
  const stance = STANCE_LIST.includes(decision.stance) ? decision.stance : null;
  const lane = LANE_LIST.includes(decision.lane) ? decision.lane : null;
  const targetFocus = ['base', 'army', 'econ'].includes(decision.targetFocus) ? decision.targetFocus : null;
  // v9：分队指令 { type: 兵种id, task: 任务, lane?: 方向 }
  let squad = null;
  if (decision.squad && typeof decision.squad === 'object') {
    const sType = VALID_ARMY_FOCUS.includes(decision.squad.type) ? decision.squad.type : null;
    const sTask = SQUAD_TASK_LIST.includes(decision.squad.task) ? decision.squad.task : null;
    const sLane = LANE_LIST.includes(decision.squad.lane) ? decision.squad.lane : null;
    if (sType && sTask) squad = { type: sType, task: sTask, lane: sLane };
  }
  // v10：给三名下属的指挥指令（一句话）
  const offenseDirective = typeof decision.offenseDirective === 'string' ? decision.offenseDirective.slice(0, 80) : '';
  const defenseDirective = typeof decision.defenseDirective === 'string' ? decision.defenseDirective.slice(0, 80) : '';
  const economyDirective = typeof decision.economyDirective === 'string' ? decision.economyDirective.slice(0, 80) : '';
  let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
  if (!armyFocus && !stance && !lane && !targetFocus && !attackNow && !squad &&
      !offenseDirective && !defenseDirective && !economyDirective && aggression === 50) {
    return null; // 完全非法
  }
  return {
    armyFocus, aggression, attackNow, stance, lane, targetFocus, squad,
    offenseDirective, defenseDirective, economyDirective, comment,
  };
}

/**
 * v10：副将（进攻/防守）命令校验——orders 数组逐条过滤。
 * 每条命令支持两种粒度：
 *   unitId: 精确指定某个单位（数字）
 *   group + count: 按兵种选 count 个单位（执行端挑选具体单位，实现逐单位分配）
 */
function clampOfficerOrders(orders, role) {
  if (!Array.isArray(orders)) return [];
  const tasks = role === 'offense' ? OFFENSE_TASKS : DEFENSE_TASKS;
  const targets = role === 'offense' ? OFFENSE_TARGETS : DEFENSE_TARGETS;
  const out = [];
  let totalUnits = 0;
  for (const o of orders) {
    if (out.length >= 8) break;
    if (!o || typeof o !== 'object') continue;
    const task = tasks.includes(o.task) ? o.task : null;
    if (!task) continue;
    const unitId = Number(o.unitId);
    const hasUnit = Number.isInteger(unitId) && unitId > 0;
    const hasGroup = VALID_ARMY_FOCUS.includes(o.group);
    if (!hasUnit && !hasGroup) continue;
    let count = Math.min(10, Math.max(1, Math.round(Number(o.count) || 1)));
    if (hasUnit) count = 1;
    if (totalUnits + count > 30) count = Math.max(1, 30 - totalUnits);
    if (count < 1) continue;
    const lane = LANE_LIST.includes(o.lane) ? o.lane : null;
    const target = targets.includes(o.target) ? o.target : null;
    out.push({
      task,
      unitId: hasUnit ? unitId : null,
      group: hasGroup ? o.group : null,
      count,
      lane,
      target,
    });
    totalUnits += count;
  }
  return out;
}

/** v10：军需官决策校验——生产计划 / 科技升级 / 哨塔选址 */
function clampQuartermaster(decision) {
  if (!decision || typeof decision !== 'object') return null;
  const production = [];
  if (Array.isArray(decision.production)) {
    for (const it of decision.production) {
      if (production.length >= 6) break;
      if (!it || !VALID_ARMY_FOCUS.includes(it.type)) continue;
      const count = Math.min(8, Math.max(1, Math.round(Number(it.count) || 1)));
      production.push({ type: it.type, count });
    }
  }
  const upgrade = UPGRADE_TRACKS.includes(decision.upgrade) ? decision.upgrade : null;
  const towers = [];
  if (Array.isArray(decision.towers)) {
    for (const t of decision.towers) {
      if (towers.length >= 4) break;
      if (!t || typeof t.spot !== 'string' || !t.spot.trim() || t.spot.length > 24) continue;
      towers.push({ spot: t.spot.trim(), priority: Number.isFinite(Number(t.priority)) ? Number(t.priority) : 99 });
    }
  }
  let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
  return { production, upgrade, towers, comment };
}

/** 按角色校验模型输出，返回该角色合法的决策对象；非法返回 null */
function clampDecision(decision, role) {
  if (role === 'offense' || role === 'defense') {
    if (!decision || typeof decision !== 'object') return null;
    const orders = clampOfficerOrders(decision.orders, role);
    let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
    if (orders.length === 0 && !comment) return null;
    return { orders, comment };
  }
  if (role === 'quartermaster') return clampQuartermaster(decision);
  return clampGeneralDecision(decision);
}

/**
 * 构建系统提示。side: 'player' | 'enemy' 决定扮演哪一方的指挥官；
 * role: 'general' | 'offense' | 'defense' | 'quartermaster' 决定角色（v10 四级指挥链）。
 */
function buildSystemPrompt(side, role) {
  const who = side === 'player' ? '玩家方' : '敌方';
  const base = '你是 RTS 游戏' + who + '军队的';
  if (role === 'offense') return buildOffensePrompt(base);
  if (role === 'defense') return buildDefensePrompt(base);
  if (role === 'quartermaster') return buildQuartermasterPrompt(base);
  return buildGeneralPrompt(base);
}

function buildGeneralPrompt(base) {
  return (
    base + '主将（最高指挥官）。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【指挥链】你的命令将由三名下属执行：进攻副将（进攻战术）、防守副将（防守战术）、' +
    '军需官（生产/科技/筑垒），全部是独立的大模型。你只需要定「战略意图」，' +
    '具体到每个单位的调动由副将完成。\n\n' +
    '【可用兵种】(armyFocus 只能取下列单位 id 之一)：\n' + UNITS_INTRO + '\n\n' +
    '【可选地图】：\n' + MAPS_INTRO + '\n\n' +
    '【科技】(myUpgrades 字段为当前等级，每线最高 5 级)：' +
    'attack军备锻造(攻击)/armor铁甲研究(减伤)/defense城防工事(箭塔与耐久)/' +
    'siegecraft破城技术(对基地伤害)/mobility疾行军(移速)。\n\n' +
    '【v9 新规则】' +
    '斥候(scout)移速全场最快，适合抢占资源点与侦查，别拿去硬拼；' +
    '建筑师(architect)可在指定位置建造防御哨塔（消耗木材与石料，哨塔高耐久、自动射箭），' +
    '态势选 fortify 即可让建筑师在已占资源点/桥头/基地附近自动筑垒；' +
    '哨塔可被敌方摧毁，注意保护。\n\n' +
    '【v10 指挥指令】除了 stance 等既有字段，请为三名下属各给一句明确指令：\n' +
    'offenseDirective(给进攻副将的一句话，如"主力压中路，骑兵绕上路骚扰敌方伐木场")、\n' +
    'defenseDirective(给防守副将的一句话，如"守住我方金矿与桥头，拦截来犯斥候")、\n' +
    'economyDirective(给军需官的一句话，如"多造斥候抢资源，升级攻击科技，在桥头建哨塔")。\n' +
    '指令要具体可执行，但不要细化到单位（那是副将的活）。\n\n' +
    '【分队指令】(squad 字段，可选)：可以只命令某个兵种（同一兵种=一个编队）执行独立任务，' +
    '其余部队仍按 stance 行动。格式：squad={type: 兵种id, task: harass/attack/defend/' +
    'capture/rally/retreat, lane?: top/mid/bottom}。\n\n' +
    '【JSON 字段】(除 comment 外都可省略)：' +
    'armyFocus(兵种倾向，取上面兵种 id 之一)、' +
    'aggression(0-100 进攻倾向)、' +
    'attackNow(布尔，是否立即总攻)、' +
    'stance(指定态势，可选 build/boom/tech/eco_defend/fortify/scout/scout_hold/counter_scout/' +
    'capture_gold/capture_wood/capture_stone/capture_expand/node_garrison/' +
    'rally/rally_hold/reinforce/harass/harass_flank/harass_econ/' +
    'assault_mid/assault_top/assault_bottom/all_in/pincer/feint/siege/' +
    'defend/defend_choke/defend_node/counter_attack/fallback/retreat/regroup/turtle/ambush/' +
    'guerrilla/priority_defense/sneak/hold_line 之一)、' +
    'squad(分队指令，见上)、' +
    'lane(主攻方向，top/mid/bottom 之一)、' +
    'targetFocus(目标侧重，base/army/econ 之一)、' +
    'offenseDirective/defenseDirective/economyDirective(给下属的指令)、' +
    'comment(不超过30字说明)。'
  );
}

function buildOffensePrompt(base) {
  return (
    base + '进攻副将。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【职责】主将（最高指挥官）的战略意图通过 user 消息中的 stance（态势）、' +
    'offenseDirective（进攻指令）、lane、targetFocus 传给你。你的任务是把战略意图翻译成' +
    '「逐单位/逐小队的战术命令」——颗粒度到具体单位：例如主将要求抢占资源，你就让 3 个斥候' +
    '同时奔赴 3 座不同的金矿；主将要求中路总攻，你就让主力沿中路推进、骑兵绕侧翼骚扰。\n\n' +
    '【可用兵种】：\n' + UNITS_INTRO + '\n\n' +
    '【通道】每条通道对应一条渡河路线：top(上路)/mid(中路)/bottom(下路)。\n\n' +
    '【输出 JSON 格式】{"orders":[...], "comment":"不超过30字说明"}\n' +
    'orders 每项：{"task":任务, "unitId":单位ID(可选), "group":兵种id(可选), ' +
    '"count":数量(1-10,仅group时), "lane":"top/mid/bottom"(可选), "target":目标(可选)}\n' +
    '任务与目标：\n' +
    '- attack 进攻：target 可为 base(敌方基地)/towers(敌方哨塔)，或省略用 lane 指定通道\n' +
    '- harass 骚扰：lane 指定侧翼通道(top/bottom)，小股打完就跑\n' +
    '- raid 劫掠经济：target=econ（敌方占领的资源点）\n' +
    '- capture 抢占资源：target=gold/wood/stone（无主资源点）或 expand（敌方基地附近前沿点）\n' +
    '- flank 绕后：lane 指定绕行通道，偷袭敌方后排\n' +
    '- kite 远程风筝：只用于远程兵种(archer/horse_archer)\n' +
    '- siege 攻城：target=base/towers，派锤子兵(hammer)等攻城单位\n' +
    '- rally 集结：target=rally，回己方集结点\n\n' +
    '【规则】\n' +
    '- 单位清单在 user 消息中（id/type/x/y/state），坐标是像素值；只给需要行动的部队下令，' +
    '通常 1-3 条命令即可，不要命令所有单位；\n' +
    '- 同一单位只给一条命令；count 不要超过清单中该兵种可用数量；\n' +
    '- 斥候(scout)/骑兵(cavalry)适合 capture/raid/harass；锤子兵(hammer)适合 siege；' +
    '远程(archer/horse_archer)适合 kite/attack；刀盾(sword)/长矛(spear)/肉盾(wall)适合 attack 扛线；\n' +
    '- 不要命令建筑师(architect)（军需官负责筑垒）。'
  );
}

function buildDefensePrompt(base) {
  return (
    base + '防守副将。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【职责】主将的战略意图通过 user 消息中的 stance 与 defenseDirective 传给你。' +
    '你负责把意图翻译成逐单位/逐小队的防守命令：例如主将要求守住金矿，' +
    '你就派最近的刀盾兵去金矿驻守、弓箭手站后排、再派一组人去桥头拦截。\n\n' +
    '【输入】user 消息包含：我方基地坐标(baseX/baseY)、入侵者列表(intruders：' +
    '每个含 type/x/y/hp，是接近我方基地/资源点的敌方单位)、我方占领的资源点' +
    '(ownedNodes：含 id/type/x/y)、各通道桥头(chokepoints：含 lane/x/y)、' +
    '可指挥单位清单(roster：id/type/x/y/state)。\n\n' +
    '【输出 JSON 格式】{"orders":[...], "comment":"不超过30字说明"}\n' +
    'orders 每项：{"task":任务, "unitId"?:单位ID, "group"?:兵种id, "count"?:数量, ' +
    '"lane"?:通道, "target"?:目标}\n' +
    '任务与目标：\n' +
    '- hold 驻守：target=choke(桥头,配lane)/node(我方资源点)/base_own(基地)，守住点位\n' +
    '- defend 回防：target=node(受威胁的资源点)/base_own(基地)，把部队拉回\n' +
    '- intercept 截击：target=nearest_intruder，派最近的单位拦截入侵者\n' +
    '- retreat 撤退：target=base_own，撤回基地（受伤单位优先）\n' +
    '- patrol 巡逻：target=choke，在桥头之间巡逻（配 lane）\n\n' +
    '【规则】\n' +
    '- 优先派离目标最近的单位；通常只命令需要调动的部队，1-3 条命令即可；\n' +
    '- 不要无条件把全部部队拉回基地——基地只有被大部队威胁时才需要重兵回防；\n' +
    '- 远程(archer/horse_archer)站后排，肉盾(sword/wall)/长矛(spear)顶前面；\n' +
    '- 斥候(scout)身板脆，一般不要用于防守。'
  );
}

function buildQuartermasterPrompt(base) {
  return (
    base + '军需官。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【职责】主将的经济指令通过 user 消息中的 economyDirective 与 stance 传给你。' +
    '你负责三件事：\n' +
    '1. production 生产计划：决定接下来造什么兵、造几个（按列表顺序执行，先出前面的）；\n' +
    '2. upgrade 科技升级：决定研究哪条科技线；\n' +
    '3. towers 防御哨塔：决定建筑师在哪里建造哨塔（从候选位置里选）。\n\n' +
    '【可用兵种】：\n' + UNITS_INTRO + '\n\n' +
    '【科技】(myUpgrades 为当前等级，最高 5 级)：' +
    'attack军备锻造(耗木材)/armor铁甲研究(耗木材)/defense城防工事(耗石料)/' +
    'siegecraft破城技术(耗石料)/mobility疾行军(耗木材)。\n\n' +
    '【输出 JSON 格式】{"production":[{"type":"兵种id","count":数量}], ' +
    '"upgrade":"科技名或null", "towers":[{"spot":"候选位置id","priority":数字}], ' +
    '"comment":"不超过30字说明"}\n\n' +
    '【规则】\n' +
    '- production 最多 6 项、每项 count 1-8；参考 enemyArmy 反制：敌方骑兵多→多产长矛兵(spear)；' +
    '敌方远程多→多产骑兵(cavalry)/斥候(scout)切入；敌方肉盾/刀盾多→多产锤子兵(hammer)；' +
    '需要攻城→锤子兵(hammer)+肉盾(wall)；缺资源点→斥候(scout)抢占；fortify 态势→建筑师(architect)；\n' +
    '- 保持前排（长矛/刀盾/肉盾）与后排（弓箭/弩手/骑射）比例合理，别全造一种；\n' +
    '- upgrade 一次只研究一项，资源不足就 null；攻击/护甲优先，城防在被压时优先，破城/疾行后置；\n' +
    '- towers 从 user 消息的 towerCandidates 里选 spot id（如 choke_mid/node_3/base_l），' +
    '最多 4 个，priority 数字越小越先建；建造消耗木材与石料。'
  );
}

/**
 * 调用大模型取得决策。provider: 'deepseek' | 'doubao'；role: v10 指挥链角色。
 * 豆包走火山方舟 ARK 的 OpenAI 兼容接口（附 thinking.type=disabled 关闭思考）。
 */
function callLLM(payload, provider, role) {
  const isDoubao = provider === 'doubao';
  const apiKey = isDoubao ? ARK_API_KEY : DEEPSEEK_API_KEY;
  const model = isDoubao ? ARK_MODEL : DEEPSEEK_MODEL;
  const endpoint = new URL(isDoubao ? ARK_ENDPOINT : DEEPSEEK_ENDPOINT);
  const side = payload && payload.side === 'player' ? 'player' : 'enemy';
  const body = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(side, role) },
      {
        role: 'user',
        content:
          '当前地图：' + (payload && payload.map && DEFS.maps.has(payload.map)
            ? (DEFS.maps.get(payload.map).doc || payload.map)
            : '未知') +
          '\n战场状态：' + JSON.stringify(payload),
      },
    ],
    stream: false,
  };
  if (isDoubao) body.thinking = { type: 'disabled' };

  return new Promise((resolve, reject) => {
    const jsonBody = JSON.stringify(body);

    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > 5_000_000) {
            reject(new Error('response too large'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`${provider} http ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            const data = JSON.parse(text);
            const content = data?.choices?.[0]?.message?.content;
            const decision = extractJson(typeof content === 'string' ? content : '');
            const clamped = clampDecision(decision, role);
            if (!clamped) reject(new Error('无法从模型输出解析出合法决策 JSON'));
            else resolve(clamped);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(AI_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout'));
    });
    req.write(jsonBody);
    req.end();
  });
}

// ---------------------------------------------------------------- 路由

async function handleAiCommand(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { ok: false, reason: 'bad_request', message: String(e.message) });
    return;
  }
  const provider = payload && payload.provider === 'doubao' ? 'doubao' : 'deepseek';
  const role = payload && ROLE_LIST.includes(payload.role) ? payload.role : 'general';
  const apiKey = provider === 'doubao' ? ARK_API_KEY : DEEPSEEK_API_KEY;
  if (!apiKey) {
    const envName = provider === 'doubao' ? 'ARK_API_KEY' : 'DEEPSEEK_API_KEY';
    sendJson(res, 200, { ok: false, reason: 'no_key', message: `未配置 ${envName}，使用规则 AI` });
    return;
  }
  try {
    const decision = await callLLM(payload, provider, role);
    sendJson(res, 200, { ok: true, decision, source: provider, role });
  } catch (e) {
    // 超时/失败/非法 → 降级，不报错中断
    const msg = String(e && e.message ? e.message : e);
    sendJson(res, 200, { ok: false, reason: 'degraded', message: msg.slice(0, 200) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/ai/command') {
    handleAiCommand(req, res).catch((e) => {
      sendJson(res, 500, { ok: false, reason: 'error', message: String(e.message) });
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      hasKey: !!DEEPSEEK_API_KEY,
      model: DEEPSEEK_MODEL,
      hasArkKey: !!ARK_API_KEY,
      arkModel: ARK_MODEL,
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`[RTS] DeepSeek Game RTS 服务器已启动`);
  console.log(`[RTS] 访问地址：http://localhost:${PORT}`);
  console.log(`[RTS] DeepSeek AI：${DEEPSEEK_API_KEY ? '已配置 (' + DEEPSEEK_MODEL + ')' : '未配置（该侧降级为规则 AI）'}`);
  console.log(`[RTS] 豆包(ARK) AI：${ARK_API_KEY ? '已配置 (' + ARK_MODEL + ')' : '未配置（该侧降级为规则 AI）'}`);
});
