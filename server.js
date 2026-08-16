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

// 小米 MiMo —— v12 新增的第三家大模型供应商
const MIMO_API_KEY = process.env.MIMO_API_KEY || '';
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.5';
const MIMO_ENDPOINT = process.env.MIMO_ENDPOINT || 'https://api.xiaomimimo.com/v1/chat/completions';

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
  // v11：多基地——统计每方基地数量（未定义 playerBases/enemyBases 时为 1）
  const pb = (m.playerBases && m.playerBases.length) ? m.playerBases.length : 1;
  const eb = (m.enemyBases && m.enemyBases.length) ? m.enemyBases.length : 1;
  return `${m.id}(${m.name})：尺寸${m.width}×${m.height} ${m.size}图，基地 玩家${pb}座(主基地${m.playerBase.tx},${m.playerBase.ty}) ` +
    `敌方${eb}座(主基地${m.enemyBase.tx},${m.enemyBase.ty})，通道[${lanes}]，资源[${resStr}]。${m.doc || ''}`;
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

// v15：三层指挥链角色（主将/军团长）
const ROLE_LIST = ['general', 'corps_commander'];
// v15：军团长可发布的抽象动作
const CORPS_ACTIONS = [
  'gather', 'advance', 'attack', 'retreat', 'defend', 'scatter',
  'flank', 'hold', 'phalanx', 'shield_wall', 'protect_flanks', 'kite', 'charge',
];
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
  // v15：给军团长的指令（数组，每项含 corpsId 和 directive）
  let corpsDirectives = [];
  if (Array.isArray(decision.corpsDirectives)) {
    for (const d of decision.corpsDirectives) {
      if (corpsDirectives.length >= 4) break;
      if (!d || typeof d !== 'object') continue;
      const corpsId = Number(d.corpsId);
      if (!Number.isInteger(corpsId) || corpsId < 0 || corpsId > 3) continue;
      const directive = typeof d.directive === 'string' ? d.directive.slice(0, 80) : '';
      if (directive) corpsDirectives.push({ corpsId, directive });
    }
  }
  let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
  if (!armyFocus && !stance && !lane && !targetFocus && !attackNow && !squad &&
      corpsDirectives.length === 0 && aggression === 50) {
    return null; // 完全非法
  }
  return {
    armyFocus, aggression, attackNow, stance, lane, targetFocus, squad,
    corpsDirectives, comment,
  };
}

/**
 * v15：军团长决策校验
 * orders[] 每项：{ unitType: 兵种id或'all', action: 抽象动作, lane?: 方向, point?: {x,y} }
 */
function clampCorpsCommander(decision) {
  if (!decision || typeof decision !== 'object') return null;
  const orders = [];
  if (Array.isArray(decision.orders)) {
    for (const o of decision.orders) {
      if (orders.length >= 8) break;
      if (!o || typeof o !== 'object') continue;
      const unitType = VALID_ARMY_FOCUS.includes(o.unitType) || o.unitType === 'all' ? o.unitType : null;
      if (!unitType) continue;
      const action = CORPS_ACTIONS.includes(o.action) ? o.action : null;
      if (!action) continue;
      const lane = LANE_LIST.includes(o.lane) ? o.lane : null;
      let point = null;
      if (o.point && typeof o.point === 'object') {
        const x = Number(o.point.x);
        const y = Number(o.point.y);
        if (Number.isFinite(x) && Number.isFinite(y)) point = { x: Math.round(x), y: Math.round(y) };
      }
      orders.push({ unitType, action, lane, point });
    }
  }
  let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
  if (orders.length === 0 && !comment) return null;
  return { orders, comment };
}

/** 按角色校验模型输出，返回该角色合法的决策对象；非法返回 null */
function clampDecision(decision, role) {
  if (role === 'corps_commander') return clampCorpsCommander(decision);
  return clampGeneralDecision(decision);
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
 * role: 'general' | 'corps_commander' 决定角色（v15 三层指挥链）。
 */
function buildSystemPrompt(side, role) {
  const who = side === 'player' ? '玩家方' : '敌方';
  const base = '你是 RTS 游戏' + who + '军队的';
  if (role === 'corps_commander') return buildCorpsCommanderPrompt(base);
  return buildGeneralPrompt(base);
}

function buildGeneralPrompt(base) {
  return (
    base + '主将（最高指挥官）。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【v15 三层指挥链】你的命令由军团长执行。系统会自动根据单位数量分配军团（每50人一个军团），' +
    '每个军团长负责组织其军团内的战术行动。你只需要定「战略意图」和给军团长的抽象指令。\n\n' +
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
    '【v11 多基地】中/大地图每方拥有多座指挥所基地（中图 2 座、大图 3 座，分别在上/中/下路），' +
    '出兵按「中基地→上基地→下基地」轮转；摧毁敌方全部基地才获胜，' +
    '进攻时优先集火血最少的一座逐个击破。斥候全阵营最多保持 3 个（生产有上限），' +
    '斥候不主动交战（被攻击才反击），专心抢资源与侦查。\n\n' +
    '【v11.1 基地摧毁与修复】基地被打到 0 血即「被摧毁」：停火、不能再出兵、渲染为废墟，' +
    '但残骸仍占位。被摧毁的基地必须派建筑师(architect)前往修复（消耗木材与石料）才能恢复，' +
    'myBasesDestroyed/enemyBasesDestroyed 字段会告诉你双方被摧毁的基地数。\n\n' +
    '【v15 军团指令（重要）】请通过 corpsDirectives 给每个军团长下达抽象战术指令：\n' +
    'corpsDirectives: [{corpsId: 0, directive: "主力压中路，长矛兵方阵推进"}, ...]\n' +
    'corpsId 从0开始，directive 是一句简明的战术要求（如"骑兵保护侧翼，弓箭手后退射击"、' +
    '"长矛手方阵推进中路"、"全军集结防守基地"）。\n' +
    '军团长会把你的指令翻译成具体的抽象动作（gather/advance/attack/retreat/defend/' +
    'scatter/flank/phalanx/shield_wall/protect_flanks/kite/charge 等），再由队长执行。\n\n' +
    '【分队指令】(squad 字段，可选)：可以只命令某个兵种执行独立任务。\n' +
    '格式：squad={type: 兵种id, task: harass/attack/defend/capture/rally/retreat, lane?: top/mid/bottom}\n\n' +
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
    'corpsDirectives(给军团长的指令数组)、' +
    'comment(不超过30字说明)。'
  );
}

/**
 * v15：军团长系统提示
 * 军团长负责将主将的抽象指令翻译为具体的战术动作，分配给各兵种队长执行
 */
function buildCorpsCommanderPrompt(base) {
  return (
    base + '军团长。你只能回复一个合法 JSON，不要输出任何其他文字。\n\n' +
    '【职责】你是军团长，负责组织军团内的战术行动。主将的抽象指令通过 user 消息中的 ' +
    'generalDirective 传给你。你的任务是把抽象指令翻译为具体的「兵种级战术动作」——' +
    '例如主将说"长矛手方阵推进中路"，你就下达 {unitType:"spear", action:"phalanx", lane:"mid"}。\n\n' +
    '【军团信息】user 消息包含：\n' +
    '- corpsUnitCounts: 军团各兵种数量\n' +
    '- corpsTotalUnits: 军团总人数\n' +
    '- corpsCenter: 军团中心坐标\n' +
    '- nearbyEnemies: 附近敌人列表\n' +
    '- lanes: 通道信息\n' +
    '- myBase/enemyBase: 双方基地位置\n\n' +
    '【可用兵种】：\n' + UNITS_INTRO + '\n\n' +
    '【抽象动作白名单】(action 字段只能取以下值)：\n' +
    '- gather: 聚集到指定点或军团中心\n' +
    '- advance: 向敌方推进（沿路线缓慢前进）\n' +
    '- attack: 全力进攻敌方\n' +
    '- retreat: 撤退到我方基地\n' +
    '- defend: 防守指定位置\n' +
    '- scatter: 分散开来（避免集火）\n' +
    '- flank: 侧翼移动（绕到敌方侧翼）\n' +
    '- hold: 待命不动\n' +
    '- phalanx: 长矛方阵推进（仅长矛兵有效）\n' +
    '- shield_wall: 盾墙防御（刀盾兵/肉盾）\n' +
    '- protect_flanks: 保护侧翼（骑兵专用）\n' +
    '- kite: 远程风筝后退（弓箭/弩手/骑射）\n' +
    '- charge: 骑兵冲锋（骑兵专用）\n\n' +
    '【输出 JSON 格式】{"orders":[...], "comment":"不超过30字说明"}\n' +
    'orders 每项：{"unitType":兵种id或"all", "action":动作, "lane":"top/mid/bottom"(可选), "point":{"x":数字,"y":数字}(可选)}\n\n' +
    '【规则】\n' +
    '- unitType 可以是具体兵种 id（如"spear"/"archer"/"cavalry"）或"all"（全军团）\n' +
    '- 通常 2-4 条指令即可，不要过度细分\n' +
    '- 合理搭配兵种动作：长矛兵phalanx推进、骑兵protect_flanks、弓箭手kite后退\n' +
    '- 主将指令模糊时，根据战场形势自行判断\n' +
    '- 敌人多时考虑defend/scatter，优势时attack/advance\n' +
    '- lane 用于指定进攻/推进的方向路线\n' +
    '- point 用于指定聚集/防守的具体位置'
  );
}

// 保留旧接口兼容（不再使用，但防报错）
function buildOffensePrompt(base) { return buildCorpsCommanderPrompt(base); }
function buildDefensePrompt(base) { return buildCorpsCommanderPrompt(base); }
function buildQuartermasterPrompt(base) { return buildCorpsCommanderPrompt(base); }
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
    '【输入】user 消息包含：我方基地坐标(baseX/baseY，主基地)、我方基地数量(myBaseCount)、' +
    '入侵者列表(intruders：' +
    '每个含 type/x/y/hp，是接近我方任一基地/资源点的敌方单位)、我方占领的资源点' +
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

/**
 * 调用大模型取得决策。provider: 'deepseek' | 'doubao' | 'mimo'；role: v15 指挥链角色。
 * 豆包走火山方舟 ARK 的 OpenAI 兼容接口（附 thinking.type=disabled 关闭思考）。
 * 小米 MiMo 走 xiaomimimo.com 的 OpenAI 兼容接口（用 api-key 头鉴权）。
 */
function callLLM(payload, provider, role) {
  const isDoubao = provider === 'doubao';
  const isMimo = provider === 'mimo';
  const apiKey = isMimo ? MIMO_API_KEY : isDoubao ? ARK_API_KEY : DEEPSEEK_API_KEY;
  const model = isMimo ? MIMO_MODEL : isDoubao ? ARK_MODEL : DEEPSEEK_MODEL;
  const endpoint = new URL(isMimo ? MIMO_ENDPOINT : isDoubao ? ARK_ENDPOINT : DEEPSEEK_ENDPOINT);
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
  // MiMo 推荐参数
  if (isMimo) {
    body.max_completion_tokens = 1024;
    body.temperature = 1.0;
    body.top_p = 0.95;
  }

  return new Promise((resolve, reject) => {
    const jsonBody = JSON.stringify(body);

    // MiMo 用 api-key 头鉴权，其余用 Authorization: Bearer
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonBody),
    };
    if (isMimo) {
      headers['api-key'] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers,
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
  const provider = payload && (payload.provider === 'doubao' || payload.provider === 'mimo') ? payload.provider : 'deepseek';
  const role = payload && ROLE_LIST.includes(payload.role) ? payload.role : 'general';
  const apiKey = provider === 'mimo' ? MIMO_API_KEY : provider === 'doubao' ? ARK_API_KEY : DEEPSEEK_API_KEY;
  if (!apiKey) {
    const envName = provider === 'mimo' ? 'MIMO_API_KEY' : provider === 'doubao' ? 'ARK_API_KEY' : 'DEEPSEEK_API_KEY';
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
      hasMimoKey: !!MIMO_API_KEY,
      mimoModel: MIMO_MODEL,
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
  console.log(`[RTS] 小米 MiMo AI：${MIMO_API_KEY ? '已配置 (' + MIMO_MODEL + ')' : '未配置（该侧降级为规则 AI）'}`);
});
