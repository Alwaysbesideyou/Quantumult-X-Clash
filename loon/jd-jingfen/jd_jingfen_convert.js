/*
 * 京粉自返利转链（Loon 版）
 * 用途：京东 APP 内自动抓京东 CK + 商品页自动京粉转链，弹通知，点击跳回京东 APP 商品页。
 * 原理参考老 QX 脚本 Tartarus2014/Script/jf_Convert.js；该脚本在 Loon 上转链分支被
 *   `if (!isQuanX) 放行` 提前退出，本脚本按 Loon 原生 API 重写两条路径：
 *   1) http-request：从 api.m.jd.com 请求头 Cookie 提取 pt_key/pt_pin 存入本地（有效期约90天）
 *   2) http-response：商品页接口响应里抽 shareUrl → 调京粉 ConvertSuperLink 转链 → 弹通知
 * 修改原因(2026-11-22#2): 真机实测 api.m.jd.com 的 wareBusiness 始终没进脚本（大量运行记录全是
 *   readCustomSurfaceList 等非目标接口），进商品页零通知。参考 wf021325/qx 的 jd_price 插件
 *   （只带路径正则、在你设备上稳弹）补两条触发线：详情页 in.m.jd.com/product/graphext/<sku>.html
 *   （响应侧）与 wareDetailAsyncFloors（请求体明文 skuId）。三条线共用 publish() 出口，sku 去重。
 * 修改原因(2026-11-22 v7 候选): 通知收敛——默认只保留京粉转链结果通知；CK 抓取通知改为独立
 *   开关 ck_notify（默认关），心跳/异常诊断统一受 debug_ping 控制（默认关）。同一次打开同一
 *   商品无论命中几个触发点都只发起一次 ConvertSuperLink（独立于通知去重的短时转链合并）。
 *   CK 只在缺失/变化/转链返回登录失效时写入，不做周期性重写。非目标 api.m.jd.com 流量在
 *   读响应体/存储之前直接放行。注意：缓存首屏可能只有 startup+视频/图片、无 SKU，本版不承诺
 *   「所有首屏都必弹」——没有商品上下文就不转链不通知。
 * 修改原因(2026-11-23 v7.1): 抓包 1009 实证缓存首屏没有商品接口，但 ccc-x.jd.com/dsp/nc 的
 *   ext 参数是 base64 商品链接，含当前 SKU（用户确认与页面商品一致）。新增该请求入口，
 *   命中即按 SKU 转链；只认解码后的 item.m.jd.com/product/<digits>.html，其他广告/非商品流量静默。
 * 修改原因(2026-11-23 v7.2): 合并「京东比价（慢慢买）」插件——比价的折线版占用 graphext 的
 *   http-response，京粉 graphext 触发改到 http-request，两边不抢同阶段脚本。请求侧不需要响应体，
 *   sku 直接取自 URL，转链走同一 publish()。
 * 隐私：CK 只存 Loon $persistentStore，不上传任何第三方；转链请求直发 api.m.jd.com。
 * 注意：自推自买违反京东联盟规则，低频自用风险自担。
 *
 * 修改原因(2026-11-23 v8): 真正合并「京东比价」——用户实际用的是 Tartarus2014/Script/jdjf_price.js，
 *   它拦 wareBusiness 响应（进商品页就弹，不用到详情页），查慢慢买历史价 + 京粉转链合成一条通知。
 *   本插件宽泛的 api.m.jd.com 响应规则与它同阶段抢脚本（Loon 同一请求只跑一条），导致装本插件后
 *   比价失效；且此前 wareBusiness 的心跳/转链一直没进本脚本，也是被它抢走的。v8 把比价逻辑并进
 *   本脚本：一次通知 = 返利 + 跳转（v8.1 起不再含历史价，比价由原插件 jdjf_price.js 自己弹）。
 *   先在插件设置里删掉旧「京粉」和「京东比价」两个插件，只装这一个。
 * 修改原因(2026-11-23 v8.1): 用户要求比价「什么都不要变、只是结合两个插件」——把 v8 并进来的
 *   比价逻辑整段移出本脚本，改由原插件 jdjf_price.js 原样承担（脚本与规则都不改，走原作者 URL）；
 *   本脚本退回纯京粉：通知只含返利+跳转，不含历史价。合并插件里比价占 api.m.jd.com 的
 *   http-response，本脚本只占 http-request，两边错开阶段，不再互相抢（Loon 同请求同阶段只跑一条）。
 *
 * 修改原因(2026-11-22): 换策略重写。诊断 v2 实证：带 ?functionId= 查询段的规则在真机
 *   从未触发（宽泛规则 A/C 稳定弹通知，B2/B3 与原插件两条查询正则全部静默），所以本版
 *   插件规则只做宽泛匹配 ^https?://api\.m\.jd\.com/，目标接口改在脚本内按 functionId
 *   分流；非目标流量零通知零改动（上一版诊断弹窗刷屏被吐槽，正式版严禁）。
 */

// ===== 可调配置 =====
const EXT1 = "200|100_3|";          // 京粉推广位参数（老脚本沿用值）
const DEBUG = false;                // true 时在 Loon 日志里打印转链原始返回

// 修改原因(2026-11-22#4): 去重分钟数/调试心跳改为插件设置项——lpx [Argument] 声明、
//   规则上 argument=[{dedup_min},{debug_ping}] 传入；$argument 形态做防御（对象/字符串/缺省）
function argVal(name, dflt) {
  try {
    if (typeof $argument === "undefined" || $argument === null) return dflt;
    if (typeof $argument === "object") {
      const v = $argument[name];
      return v === undefined || v === null || v === "" ? dflt : v;
    }
    // 修改原因(2026-11-22#5 审阅): 字符串兜底硬化——先 trim（防前导空白 JSON 解析不到）；
    //   JSON 分支同样把 null/空串归一到默认值（防 dedup_min:null 被 Number 成 0 误关去重）；
    //   k=v 匹配加词边界（防 xdedup_min=0 误命中）
    const s = String($argument).trim();
    if (s.charAt(0) === "{") {
      try {
        const o = JSON.parse(s);
        if (o && o[name] !== undefined && o[name] !== null && o[name] !== "") return o[name];
      } catch (e) {}
    }
    const m = s.match(new RegExp("(?:^|[,\\s;&{])" + name + "=([0-9A-Za-z_.-]+)"));
    if (m) return m[1];
  } catch (e) {}
  return dflt;
}
// 同一商品在该时长内不重复弹通知；0 = 每次都弹（用户要求）
const DEDUP_MINUTES = (function () {
  const n = Number(argVal("dedup_min", 10));
  return isFinite(n) && n >= 0 ? n : 10;
})();
// 心跳/异常诊断只对目标商品接口弹（非目标静默）；默认关，插件设置里可开（排障用）
const DEBUG_PING = (function () {
  const v = argVal("debug_ping", false);
  return v === true || v === "true" || v === 1 || v === "1";
})();
// 修改原因(2026-11-22 v7 候选): CK 抓取通知独立开关——用户要求默认只看转链结果通知，
//   抓到 CK 属于例行事件，不再默认打扰；需要确认抓取时在插件设置里打开
const CK_NOTIFY = (function () {
  const v = argVal("ck_notify", false);
  return v === true || v === "true" || v === 1 || v === "1";
})();
const DIAG_COOLDOWN_SEC = 30;       // 心跳/异常诊断通知冷却，防一次商品页多个响应刷屏
// 修改原因(2026-11-22 v7 候选): 同一次打开同一商品的转链合并窗口——多个接口/请求与响应
//   都可能命中同一 SKU，dedup_min=0（每次进入都弹）也不能让同页多个触发点重复转链；
//   独立于通知去重的短时 map，窗口过后再次进入仍会转链
const CONVERT_GUARD_SEC = 8;
// ===================

const CK_KEY = "jd_jf_cookie";
const DEDUP_KEY = "jd_jf_last";
const GUARD_KEY = "jd_jf_convert_guard"; // 转链合并表（独立于通知去重表）
const DIAG_KEY = "jd_jf_diag_ts";        // 通用诊断冷却
// 修改原因(2026-11-22): REQ/RESP 心跳分开冷却——共用一个 key 时响应心跳会被请求心跳顶掉，
//   恰好遮住最需要验证的「响应侧」链路
const DIAG_KEY_REQ = "jd_jf_diag_req";
const DIAG_KEY_RESP = "jd_jf_diag_resp";
const WX_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN";
const WX_REFERER = "https://servicewechat.com/wxf463e50cd384beda/114/page-frame.html"; // 京粉小程序

// 修改原因(2026-11-22#6 审阅): 入口先做安全兜底——$request 未注入时也不在 try 外抛 ReferenceError；
//   HTTP 头名不区分大小写，统一转小写匹配（只认 x-referer-page/X-Referer-Page 两种写法会漏触发）
const REQ = (typeof $request !== "undefined" && $request) || {};
function headerOf(name) {
  const h = REQ.headers || {};
  const key = String(name).toLowerCase();
  for (const k in h) {
    if (String(k).toLowerCase() === key) return h[k];
  }
  return "";
}
const url = REQ.url || "";

// 目标接口分流
// 修改原因(2026-11-22): 规则宽泛化后所有 api.m.jd.com 流量都进本脚本，目标判定移入脚本：
//   非商品/配置接口一律静默放行、零通知、零改动。functionId 必须以 ? 或 & 开头锚定，
//   避免 body 参数里编码的字符串造成误判（编码后是 %3D 不会命中）。
const RE_PRODUCT = /[?&]functionId=(wareBusiness|lite_wareBusiness|pingou_item)(?:&|$)/;
const RE_CONFIG = /[?&]functionId=(serverConfig|basicConfig)(?:&|$)/;
// 修改原因(2026-11-22#2): 参考 wf021325/qx 的 jd_price 插件——它「只在进商品页时弹」且在你设备上实测有效，
//   触发点是 in.m.jd.com/product/graphext/<sku>.html（纯路径正则、无查询段）。据此补两条触发线：
//   ① 详情页页面 in.m.jd.com/product/graphext/<sku>.html（响应侧，sku 就在 URL 路径里）
//   ② wareDetailAsyncFloors 请求体是明文 JSON、自带 skuId（wareBusiness 请求体是 ciphertype:5 加密，
//      只能从响应抽 shareUrl），作为「进商品页」的第二触发点
const RE_GRAPH = /^https?:\/\/in\.m\.jd\.com\/product\/graphext\/(\d+)\.html(?:[/?#]|$)/;
// 修改原因(2026-11-23 v7.1): 缓存首屏唯一带当前商品 SKU 的请求——ccc-x 广告上报的 ext 是
//   base64 商品链接；只处理 dsp/nc，且解码后必须是 item.m.jd.com/product/<sku>.html 才转链
const RE_AD = /^https?:\/\/ccc-x\.jd\.com\/dsp\/nc(?:[?#]|$)/i;
// 修改原因(2026-11-22#3): 边界放宽为 (?:^|[?&])——functionId 在 POST body 里时位于串首，
//   原先要求前面必有 ?/& 会漏掉（回归用例 8 实测漏）；URL 侧 ?functionId= 行为不变
// 修改原因(2026-11-22#4): 改名 RE_ENTRY 并扩到 4 个入口接口——抓包实证进商品页那一秒，
//   queryWechatDomainActivity_jsf / asynInteface / wareDetailAsyncFloors 请求体都带明文 skuId，
//   且 queryWechatDomainActivity_jsf 响应里还有 shareUrl；多点挂钩提高「进商品页即弹」命中率
const RE_ENTRY = /(?:^|[?&])functionId=(wareDetailAsyncFloors|lite_wareDetailAsyncFloors|queryWechatDomainActivity_jsf|asynInteface)(?:&|$)/;
// 修改原因(2026-11-22#5 审阅): queryWechatDomainActivity_jsf 响应里带 shareUrl（1190B）——
//   请求侧没提出 sku 时的兜底入口，响应侧也认它
const RE_JSF = /(?:^|[?&])functionId=queryWechatDomainActivity_jsf(?:&|$)/;
// 修改原因(2026-11-22#5 审阅): 通用分发接口集合——必须带商品页上下文才允许转链（单独抽常量，
//   原写法 用 (reqBody || url) 只测了 body，body 非空时 URL 侧的 functionId 漏判，闸门失效）
const RE_GENERIC = /(?:^|[?&])functionId=(queryWechatDomainActivity_jsf|asynInteface)(?:&|$)/;

// ---------- 工具 ----------
function readCk(headers) {
  const h = headers || {};
  const c = h.Cookie || h.cookie || "";
  const key = c.match(/pt_key=([^;]+)/);
  const pin = c.match(/pt_pin=([^;]+)/);
  return key && pin ? `pt_key=${key[1]};pt_pin=${pin[1]};` : "";
}

function saveCkIfNew() {
  const ck = readCk(REQ.headers);
  if (!ck) return "";
  const old = $persistentStore.read(CK_KEY) || "";
  // 修改原因(2026-11-22 v7 候选): CK 不做机械重写——只在缺失/变化时写入，相同则零写零通知
  if (ck === old) return ck;
  // 修改原因(2026-11-21审阅): 写入失败时不应谎报「已捕获」
  if ($persistentStore.write(ck, CK_KEY)) {
    // 修改原因(2026-11-22 v7 候选): CK 抓取通知受独立开关 ck_notify 控制，默认关
    if (CK_NOTIFY) {
      try {
        notify("京东CK已捕获", "京粉转链可用（APP 抓的 CK 有效期约 90 天）");
      } catch (e) {
        console.log("jd_jingfen ck notify error: " + String(e));
      }
    }
  }
  return ck;
}

// 修改原因(2026-11-22 v7 候选): 转链返回 430（登录失效）时清掉失效 CK——这是用户指定的
//   三个 CK 更新时机之一；清空后下次命中商品/配置接口会按「缺失」重新捕获新 CK
function clearInvalidCk() {
  try {
    const old = $persistentStore.read(CK_KEY) || "";
    if (old) $persistentStore.write("", CK_KEY);
  } catch (e) {
    console.log("jd_jingfen clearInvalidCk error: " + String(e));
  }
}

function notify(title, text, openUrl) {
  if (openUrl) $notification.post(title, "", text, { openUrl });
  else $notification.post(title, "", text);
}

function diagNotify(title, text, key) {
  // 修改原因(2026-11-22 v7 候选): 异常/心跳类诊断通知统一受 debug_ping 控制——默认只保留
  //   转链结果通知；排障时打开开关即可恢复全部诊断
  if (!DEBUG_PING) return;
  // 修改原因(2026-11-21): 心跳/异常通知按 DIAG_COOLDOWN_SEC 冷却，一次商品页只出一条
  try {
    const k = key || DIAG_KEY;
    const last = Number($persistentStore.read(k) || "0");
    if (Date.now() - last < DIAG_COOLDOWN_SEC * 1000) return;
    $persistentStore.write(String(Date.now()), k);
  } catch (e) {}
  // 修改原因(2026-11-21): 通知失败不能影响响应放行——吞掉 $notification.post 异常
  try {
    notify(title, text);
  } catch (e) {
    console.log("jd_jingfen diagNotify error: " + String(e));
  }
}

function jumpScheme(target) {
  // 跳回京东 APP：openjd scheme + babel 跳转参数
  const params = JSON.stringify({
    category: "jump",
    des: "m",
    sourceValue: "babel-act",
    sourceType: "babel",
    url: target,
  });
  return "openjd://virtual?params=" + encodeURIComponent(params);
}

function extractShareUrl(obj, body) {
  try {
    if (obj && obj.floors && obj.floors.length) {
      const info = obj.floors[obj.floors.length - 1];
      const u = info && info.data && info.data.property && info.data.property.shareUrl;
      if (u) return u;
    }
    if (obj && obj.others && obj.others.property && obj.others.property.shareUrl)
      return obj.others.property.shareUrl;
    if (obj && obj.domain && obj.domain.h5Url) return obj.domain.h5Url;
  } catch (e) {}
  const m = body.match(/"shareUrl"\s*:\s*"((?:\\.|[^"\\])+)"/);
  if (!m) return "";
  try {
    return JSON.parse('"' + m[1] + '"'); // 修改原因(2026-11-21审阅): 完整还原 \/ \\ \u 等转义
  } catch (e) {
    return m[1].replace(/\\\//g, "/");
  }
}

function skuOf(u) {
  const m = u.match(/(\d+)\.html/) || u.match(/sku=(\d+)/) || u.match(/wareId=(\d+)/);
  return m ? m[1] : "";
}

// 修改原因(2026-11-23 v7.1): Loon JS 不保证有 atob/Buffer，自己解标准 base64（兼容 base64url
//   的 -_ 字符和缺省 padding）；只用于解析 ccc-x 的 ext，输入长度很小
function b64decode(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "=") break;
    const v = chars.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buf >> bits) & 255);
    }
  }
  return out;
}

// 修改原因(2026-11-23 v7.1 审阅): 解码结果必须整串就是一个商品链接，不能是包含链接的 JSON/
//   多商品广告载荷；只认 item.m.jd.com，不收 item.jd.com；允许 ?query/#hash 后缀
function skuFromAd(text) {
  const s0 = String(text || "");
  const m =
    s0.match(/[?&]ext=([^&#\s]+)/) ||
    s0.match(/(?:^|[\s&])ext=([^&#\s]+)/) ||
    s0.match(/"ext"\s*:\s*"([^"]+)"/);
  if (!m) return "";
  let s = m[1];
  try {
    s = decodeURIComponent(s);
  } catch (e) {}
  const decoded = b64decode(s).trim();
  const mm = decoded.match(/^https?:\/\/item\.m\.jd\.com\/product\/(\d+)\.html(?:[?#].*)?$/i);
  return mm ? mm[1] : "";
}

// 修改原因(2026-11-22#2): 从 wareDetailAsyncFloors 的 POST body 取 skuId——该接口 body 是明文 JSON
//   （{"skuId":"100069476020",...}）；兼容表单形态 functionId=...&body=<urlencode(JSON)> 再解一层
function skuFromBody(b) {
  if (!b) return "";
  let s = "";
  try {
    s = decodeURIComponent(b.replace(/\+/g, " "));
  } catch (e) {
    s = b;
  }
  let t = s;
  const mb = s.match(/[?&]body=([^&]+)/);
  if (mb) {
    try {
      t = decodeURIComponent(mb[1]);
    } catch (e) {}
  }
  const m =
    t.match(/"skuId"\s*:\s*"?(\d+)/) ||
    t.match(/[?&]skuId=(\d+)/) ||
    t.match(/"wareId"\s*:\s*"?(\d+)/) ||
    t.match(/[?&]wareId=(\d+)/);
  return m ? m[1] : "";
}

function itemUrlOf(sku) {
  // 标准商品链接：老抓包用同款链接当 materialInfo 转链成功（code=200 有 promotionUrl）
  return "https://item.m.jd.com/product/" + sku + ".html";
}

// 修改原因(2026-11-22#2): 商品页/详情页/楼层三条触发线共用的统一出口——去重 → 转链 → 通知；
//   onDone 用于调用方收口（响应侧传 finish，请求侧传 null）
// 修改原因(2026-11-22#2审阅): 去重从「单条 last 记录」改为按 SKU 的 map——旧版在 A→B→A 场景
//   会把 A 再弹一次；map 只保留最近 30 条、自动清过期项，避免存储膨胀
function isDupAndMark(dedupId) {
  // 修改原因(2026-11-22#4): dedup_min=0 表示每次都弹（用户要求的开关语义），直接不查不写
  if (!(DEDUP_MINUTES > 0)) return false;
  if (!dedupId) return false;
  try {
    const now = Date.now();
    const ttl = DEDUP_MINUTES * 60000;
    let m = JSON.parse($persistentStore.read(DEDUP_KEY) || "{}");
    if (m && m.id !== undefined) {
      // 兼容旧版 {id, ts} 单条格式
      const legacy = m;
      m = {};
      if (legacy.id) m[legacy.id] = legacy.ts;
    }
    // 修改原因(2026-11-22#2审阅): 存储被损坏成数组时，纯数字 SKU 会变数组下标（JSON 膨胀且丢标记）——强制重置
    if (!m || typeof m !== "object" || Array.isArray(m)) m = {};
    for (const k in m) if (!(now - m[k] < ttl)) delete m[k];
    if (m[dedupId]) return true;
    m[dedupId] = now;
    const keys = Object.keys(m).sort((a, b) => m[a] - m[b]);
    while (keys.length > 30) delete m[keys.shift()];
    $persistentStore.write(JSON.stringify(m), DEDUP_KEY);
    return false;
  } catch (e) {
    return false;
  }
}

// 修改原因(2026-11-22 v7 候选): 独立于通知去重的转链合并表——同一 SKU 在 CONVERT_GUARD_SEC
//   秒内只允许发起一次 ConvertSuperLink。与 dedup 表分开存：dedup_min=0（每次进入都弹）
//   只解除通知冷却，不解除转链合并；存储异常时放行转链，不让合并表故障挡住主功能
function isConvertDupAndMark(guardId) {
  if (!guardId) return false;
  try {
    const now = Date.now();
    const ttl = CONVERT_GUARD_SEC * 1000;
    let m = JSON.parse($persistentStore.read(GUARD_KEY) || "{}");
    if (!m || typeof m !== "object" || Array.isArray(m)) m = {};
    for (const k in m) if (!(now - m[k] < ttl)) delete m[k];
    if (m[guardId]) return true;
    m[guardId] = now;
    const keys = Object.keys(m).sort((a, b) => m[a] - m[b]);
    while (keys.length > 30) delete m[keys.shift()];
    $persistentStore.write(JSON.stringify(m), GUARD_KEY);
    return false;
  } catch (e) {
    return false;
  }
}

function publish(shareUrl, sku, onDone) {
  const dedupId = sku || shareUrl;
  // 修改原因(2026-11-22 v7 候选): 先做同页转链合并再做通知去重——合并命中时连 ConvertSuperLink
  //   都不发起（省请求省流量），通知冷却表也因此不会被同页重复触发点反复写入
  if (isConvertDupAndMark(dedupId)) {
    if (onDone) onDone();
    return;
  }
  // 修改原因(2026-11-21审阅): 转链前就写冷却——失败/无返利/无CK 的通知同样去重，并发响应不会全部穿透
  if (isDupAndMark(dedupId)) {
    if (onDone) onDone();
    return;
  }
  // 修改原因(2026-11-23 v8.1): 比价已移回原插件，本通知只留返利。收口沿用 v8 二审通过的模式——
  //   先 $notification.post 再 onDone()，released 闸门保证通知与 $done 各恰好一次；
  //   2.4s 看门狗短于调用方 3s 保底，转链回调丢失也能出一条通知并放行
  let released = false;
  const release = function (r) {
    if (released) return;
    released = true;
    try {
      notify("京粉转链", (r && r.msg) || "转链无结果（未知状态）", r && r.link ? jumpScheme(r.link) : "");
    } catch (e) {
      console.log("jd_jingfen notify error: " + String(e));
    }
    if (onDone) onDone();
  };
  convert(shareUrl, function (r) {
    release(r);
  });
  setTimeout(function () {
    release(null);
  }, 2400);
}

// ---------- 转链 ----------
function convert(shareUrl, cb) {
  const ck = $persistentStore.read(CK_KEY) || "";
  if (!ck) {
    cb({ msg: "还没抓到京东CK：先在京东APP里点一次「签到」，或重新打开商品页触发抓取" });
    return;
  }
  const body = {
    funName: "getSuperClickUrl",
    param: { materialInfo: shareUrl, ext1: EXT1 },
  };
  const api =
    "https://api.m.jd.com/api?functionId=ConvertSuperLink&appid=u&_=" +
    Date.now() +
    "&body=" +
    encodeURIComponent(JSON.stringify(body)) +
    "&loginType=2";
  $httpClient.get(
    {
      url: api,
      headers: {
        Cookie: ck,
        "User-Agent": WX_UA,
        Referer: WX_REFERER,
        "content-type": "application/json",
        "Accept-Encoding": "gzip,compress,br,deflate",
      },
    },
    (error, resp, data) => {
      // 修改原因(2026-11-21): 回调整体兜底——解析/判断抛错也必须产出结果并走 cb，
      //   否则外层 $done 永远不被调用，商品页请求会挂起
      let r = null;
      try {
        if (error) {
          r = { msg: "转链请求失败：" + error };
        } else {
          let d = null;
          try {
            d = JSON.parse(data);
          } catch (e) {
            d = null;
          }
          if (DEBUG) console.log("ConvertSuperLink: " + String(data).slice(0, 500));
          if (!d || typeof d !== "object") {
            r = { msg: "转链返回非 JSON，接口可能已变动" };
          } else if (d.code === 200 && d.data) {
            if (d.data.promotionUrl) {
              r = {
                msg: `💰返点 ${d.data.wlCommissionShare}%｜预计返利 ¥${d.data.wlCommission}`,
                link: d.data.promotionUrl,
              };
            } else {
              r = { msg: "该商品暂无返利" + (d.data.formatContext ? "：" + String(d.data.formatContext).trim() : "") };
            }
          } else if (d.code === 105) {
            r = { msg: "京喜/极速版链接不支持此转链" };
          } else if (d.code === 430) {
            // 修改原因(2026-11-22 v7 候选): 登录失效是用户指定的 CK 更新时机之一——
            //   清掉失效 CK，下次命中商品/配置接口时按缺失重新捕获，不做周期性重写
            clearInvalidCk();
            r = { msg: "京粉登录态失效：重新抓一次 CK，或检查是否已在京粉完成推客认证" };
          } else {
            r = { msg: "转链失败：" + String(d.message || JSON.stringify(d)).slice(0, 120) };
          }
        }
      } catch (e) {
        r = { msg: "转链响应处理异常：" + String(e).slice(0, 120) };
      }
      cb(r || { msg: "转链无结果（未知状态）" });
    }
  );
}

// ---------- 入口 ----------
// 修改原因(2026-11-22 v7 候选): 非目标流量快速退出——宽泛规则下 api.m.jd.com 绝大多数
//   流量与本插件无关，在进入请求/响应分支、读响应体、读写存储之前先做一次目标判定，
//   非目标直接 $done({}) 静默放行（零通知零存储零网络）。目标判定覆盖 URL 与请求体两面
//   （functionId 可能只在 POST body 里），与既有闸门逻辑一致，不改 MITM/规则面。
const REQ_BODY = typeof REQ.body === "string" ? REQ.body : "";
const IS_API = /^https?:\/\/api\.m\.jd\.com\//i.test(url);
const IS_GRAPH = RE_GRAPH.test(url);
// 修改原因(2026-11-23 v7.1): ccc-x 广告入口不在 api.m.jd.com，需单独放行给请求分支；
//   未命中 RE_AD 的其他 ccc-x 流量仍按非目标静默
const IS_AD = RE_AD.test(url);
const API_TARGET =
  RE_PRODUCT.test(url) ||
  RE_CONFIG.test(url) ||
  RE_ENTRY.test(url) ||
  (REQ_BODY && (RE_ENTRY.test(REQ_BODY) || RE_PRODUCT.test(REQ_BODY) || RE_CONFIG.test(REQ_BODY)));
if ((IS_API && !API_TARGET) || (!IS_API && !IS_GRAPH && !IS_AD)) {
  $done({}); // 修改原因(2026-11-22 v7 候选): 快速放行也必须恰好一次 $done，且用 {} 不断连
} else if (typeof $response === "undefined") {
  // 路径 1：请求——只有目标接口才动手
  // 修改原因(2026-11-22#4): 统一 reqFinish 收口 + 整体 try/catch——任何异常都必须放行，
  //   否则 $done 漏调会让 APP 请求挂起（商品页转圈）；reqDone 闸门保证恰好一次
  let reqDone = false;
  const reqFinish = () => {
    if (reqDone) return;
    reqDone = true;
    $done({}); // 修改原因(2026-11-21审阅): Loon 无参 $done() 会断开请求，必须 {} 原样放行
  };
  try {
    // 修改原因(2026-11-22审阅): 非目标流量零通知零改动——抓 CK 收敛到商品/配置接口
    // 修改原因(2026-11-22#5 审阅): 不把 RE_ENTRY 算进抓 CK 触发面——否则购物车页等非商品上下文的
    //   asynInteface 也会走抓取，无 CK 时弹「还没抓到京东CK」提示，属非目标噪声
    if (RE_PRODUCT.test(url) || RE_CONFIG.test(url)) {
      try {
        saveCkIfNew();
      } catch (e) {} // 修改原因(2026-11-21): 抓 CK 出错也不能断连
      if (DEBUG_PING && RE_PRODUCT.test(url)) {
        diagNotify("京粉转链｜心跳REQ", "请求侧链路通✓ " + url.slice(0, 60), DIAG_KEY_REQ);
      }
    }

    // 修改原因(2026-11-23 v7.2): 京粉详情页触发改到请求侧，给比价插件的 response 折线图让路。
    //   请求侧只需 URL 里的 sku，不需要响应体；转链完成再放行 + 3 秒保底。
    if (RE_GRAPH.test(url)) {
      const sku = (url.match(RE_GRAPH) || [])[1] || "";
      if (sku) {
        if (DEBUG_PING) {
          diagNotify("京粉转链｜心跳详情页REQ", "graphext 请求命中✓ sku=" + sku, DIAG_KEY_REQ);
        }
        setTimeout(reqFinish, 3000);
        publish(itemUrlOf(sku), sku, reqFinish);
        return;
      }
    }

    // 修改原因(2026-11-23 v7.1): 缓存首屏的商品接口可能一条都不发，但 ccc-x 广告上报的 ext
    //   里带当前商品链接；解出 SKU 后按标准商品链接转链。只认整串 item.m.jd.com/product/<digits>.html。
    // 修改原因(2026-11-23 v7.1 审阅): 请求若带 x-referer-page 且不是 WareInfo（首页推荐流等）则静默；
    //   1009 真实请求不带该头，因此不能强制要求有头，只做「有头必验」的防误转闸门。ext 可在 URL 或 body。
    if (RE_AD.test(url)) {
      const adText = url + "\n" + (typeof REQ.body === "string" ? REQ.body : "");
      const sku = skuFromAd(adText);
      const adRef = headerOf("x-referer-page") || "";
      const adContextOk = !adRef || /WareInfo/i.test(adRef);
      if (sku && adContextOk) {
        if (DEBUG_PING) {
          diagNotify("京粉转链｜心跳广告入口", "ccc-x 命中✓ sku=" + sku, DIAG_KEY_REQ);
        }
        setTimeout(reqFinish, 3000);
        publish(itemUrlOf(sku), sku, reqFinish);
        return;
      }
    }

    // 修改原因(2026-11-22#4): 进商品页那一秒必发、请求体带明文 skuId 的接口在此转链——
    //   进商品页即弹，不必等滑到『详情』。读 $request.body 依赖 lpx requires-body=true
    const reqBody = typeof REQ.body === "string" ? REQ.body : "";
    if (RE_ENTRY.test(url) || (reqBody && RE_ENTRY.test(reqBody))) {
      const sku = skuFromBody(reqBody || url);
      const ref = headerOf("x-referer-page") || "";
      const isWarePage = /WareInfo/i.test(ref);
      // 修改原因(2026-11-22#5 审阅 REJECT): asynInteface 是通用分发接口（别的页面也会发、也可能带 skuId），
      //   queryWechatDomainActivity_jsf 同理——这两个必须商品页上下文（x-referer-page=WareInfo*）才允许转链，
      //   否则会替用户不看的商品转链+弹窗；wareDetailAsyncFloors 是商品详情专属接口，不受此限
      const needsWarePage = RE_GENERIC.test(url) || (reqBody && RE_GENERIC.test(reqBody));
      if (sku && (!needsWarePage || isWarePage)) {
        if (DEBUG_PING) {
          diagNotify("京粉转链｜心跳入口", "进商品页命中✓ sku=" + sku + " " + url.slice(0, 55), DIAG_KEY_REQ);
        }
        // 修改原因(2026-11-22#2审阅): 转链完成再放行 + 3 秒保底释放，页面不被转链耗时挂住
        setTimeout(reqFinish, 3000);
        publish(itemUrlOf(sku), sku, reqFinish);
        return;
      }
      // 修改原因(2026-11-22#4): 仅商品页上下文提取失败才报异常，非商品页 asynInteface 静默
      if (!sku && isWarePage) {
        diagNotify("京粉转链｜异常", "商品页请求命中但没提出 skuId：" + url.slice(0, 60), DIAG_KEY_RESP);
      }
    }
  } catch (e) {
    diagNotify("京粉转链｜异常", "请求侧脚本错误：" + String(e).slice(0, 120), DIAG_KEY_RESP);
  }
  reqFinish();
} else {
  // 路径 2：响应——按 functionId 分流
  const body = typeof $response.body === "string" ? $response.body : "";
  let finished = false;
  // 修改原因(2026-11-22): finish 一律 $done({}) 原样放行（含响应体），不回填 body；
  //   只有 httpdns 清理路径回写改过的 body。$done 只允许调用一次。
  const finish = () => {
    if (finished) return;
    finished = true;
    $done({});
  };

  try {
    // 修改原因(2026-11-22#2): 详情页页面——参考 jd_price 插件实证的商品页触发点（纯路径正则，最稳）。
    //   sku 直接取自 URL；页面 HTML 若带 shareUrl 就用它，否则用 sku 拼标准商品链接去转链
    if (RE_GRAPH.test(url)) {
      try {
        saveCkIfNew();
      } catch (e) {}
      const sku = (url.match(RE_GRAPH) || [])[1] || "";
      const su = extractShareUrl(null, body) || (sku ? itemUrlOf(sku) : "");
      if (DEBUG_PING) {
        // 修改原因(2026-11-22#2): 心跳带 sku 和响应体大小——这条线一旦弹出来，转链链路就定了
        diagNotify("京粉转链｜心跳详情页", `graphext 命中✓ sku=${sku || "?"} ${body.length}B`, DIAG_KEY_RESP);
      }
      if (su) publish(su, sku, finish);
      else finish();
      return;
    }

    if (RE_CONFIG.test(url)) {
      // 修改原因(2026-11-22审阅): 抓 CK 收敛到目标接口（含本分支），非目标流量零通知零改动
      try {
        saveCkIfNew();
      } catch (e) {}
      // 清掉 httpdns 配置，防止京东 APP 走 HTTPDNS 绕过 Loon MITM（沿用老脚本做法）
      // 修改原因(2026-11-22): 本版响应规则未带 requires-body（诊断 C 实证不加 flag 也有 body）；
      //   若个别 Loon 版本忽略 body 回写，本段等效原样放行，不影响转链主功能
      try {
        const obj = JSON.parse(body);
        if (obj.serverConfig) {
          delete obj.serverConfig.httpdns;
          delete obj.serverConfig.dnsvip;
          delete obj.serverConfig.dnsvip_v6;
        }
        if (obj.data && obj.data.JDHttpToolKit) {
          delete obj.data.JDHttpToolKit.httpdns;
          delete obj.data.JDHttpToolKit.dnsvipV6;
        }
        if (obj.data && obj.data.jCommandConfig) delete obj.data.jCommandConfig.httpdnsConfig;
        const s = JSON.stringify(obj); // 修改原因(2026-11-21): 先算好再置 finished，避免 stringify 抛错后 $done 漏调
        finished = true;
        $done({ body: s });
      } catch (e) {
        finish();
      }
      return;
    }

    // 修改原因(2026-11-22): 非目标接口静默放行——宽泛规则下绝大多数流量走到这里，严禁弹通知
    // 修改原因(2026-11-22#5 审阅): 商品页响应面加上 queryWechatDomainActivity_jsf（其响应带 shareUrl）；
    //   与请求侧对称——该接口只在商品页上下文才认，非商品页的 JSF 响应静默放行
    const respRef = headerOf("x-referer-page") || "";
    // 修改原因(2026-11-22#6 审阅): JSF 的 functionId 也可能只在请求体里，响应侧同样两面都认
    const respJsfOk = (RE_JSF.test(url) || (typeof REQ.body === "string" && RE_JSF.test(REQ.body))) && /WareInfo/i.test(respRef);
    if (!RE_PRODUCT.test(url) && !respJsfOk) {
      finish();
      return;
    }

    // 修改原因(2026-11-22审阅): 抓 CK 收敛到目标接口——商品页请求带 Cookie，顺带补抓，免专门去签到
    try {
      saveCkIfNew();
    } catch (e) {}

    // 商品页：心跳 + 去重后转链弹通知，响应体原样放行
    if (!body) {
      diagNotify("京粉转链｜异常", "商品页响应体为空（疑似被 Loon 限制跳过）：" + url.slice(0, 80), DIAG_KEY_RESP);
      finish();
      return;
    }
    let obj = null;
    let parseOk = true;
    try {
      obj = JSON.parse(body);
    } catch (e) {
      parseOk = false;
    }
    const shareUrl = extractShareUrl(obj, body);
    const sku = skuOf(shareUrl);

    if (DEBUG_PING) {
      // 修改原因(2026-11-21): 心跳定位——只要弹出来就证明 Loon 拦截+脚本执行链路通
      // 修改原因(2026-11-22): 心跳带 RESP 标记与响应体大小，和请求心跳配对看链路
      diagNotify(
        "京粉转链｜心跳RESP",
        `响应侧链路通✓ ${body.length}B，JSON${parseOk ? "✓" : "✗"}，shareUrl${shareUrl ? "✓" : "✗"}`,
        DIAG_KEY_RESP
      );
    }

    // 修改原因(2026-11-22#2): 去重/转链/通知收敛到 publish()，三条触发线共用一套出口
    if (!shareUrl) {
      diagNotify("京粉转链｜异常", "商品页响应里没找到 shareUrl（接口结构可能已变动），请截图给我", DIAG_KEY_RESP);
      finish();
    } else {
      publish(shareUrl, sku, finish);
    }
  } catch (e) {
    // 修改原因(2026-11-21): 未预期异常必须出声并放行，否则 APP 页面会挂、用户也看不到原因
    diagNotify("京粉转链｜异常", "脚本内部错误：" + String(e).slice(0, 150), DIAG_KEY_RESP);
    finish();
  }
}
