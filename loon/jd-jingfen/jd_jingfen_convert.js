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
 * 隐私：CK 只存 Loon $persistentStore，不上传任何第三方；转链请求直发 api.m.jd.com。
 * 注意：自推自买违反京东联盟规则，低频自用风险自担。
 *
 * 修改原因(2026-11-22): 换策略重写。诊断 v2 实证：带 ?functionId= 查询段的规则在真机
 *   从未触发（宽泛规则 A/C 稳定弹通知，B2/B3 与原插件两条查询正则全部静默），所以本版
 *   插件规则只做宽泛匹配 ^https?://api\.m\.jd\.com/，目标接口改在脚本内按 functionId
 *   分流；非目标流量零通知零改动（上一版诊断弹窗刷屏被吐槽，正式版严禁）。
 */

// ===== 可调配置 =====
const EXT1 = "200|100_3|";          // 京粉推广位参数（老脚本沿用值）
const DEDUP_MINUTES = 10;           // 同一商品在该时长内不重复弹通知
const DEBUG = false;                // true 时在 Loon 日志里打印转链原始返回
// 修改原因(2026-11-22): 心跳只对目标商品接口弹（非目标静默）；确认出返点通知后改 false
const DEBUG_PING = true;            // true 时商品页目标接口弹心跳（验证链路用，确认后关）
const DIAG_COOLDOWN_SEC = 30;       // 心跳/异常诊断通知冷却，防一次商品页多个响应刷屏
// ===================

const CK_KEY = "jd_jf_cookie";
const DEDUP_KEY = "jd_jf_last";
const DIAG_KEY = "jd_jf_diag_ts";        // 通用诊断冷却
// 修改原因(2026-11-22): REQ/RESP 心跳分开冷却——共用一个 key 时响应心跳会被请求心跳顶掉，
//   恰好遮住最需要验证的「响应侧」链路
const DIAG_KEY_REQ = "jd_jf_diag_req";
const DIAG_KEY_RESP = "jd_jf_diag_resp";
const WX_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN";
const WX_REFERER = "https://servicewechat.com/wxf463e50cd384beda/114/page-frame.html"; // 京粉小程序

const url = $request.url;

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
const RE_FLOORS = /[?&]functionId=(wareDetailAsyncFloors|lite_wareDetailAsyncFloors)(?:&|$)/;

// ---------- 工具 ----------
function readCk(headers) {
  const h = headers || {};
  const c = h.Cookie || h.cookie || "";
  const key = c.match(/pt_key=([^;]+)/);
  const pin = c.match(/pt_pin=([^;]+)/);
  return key && pin ? `pt_key=${key[1]};pt_pin=${pin[1]};` : "";
}

function saveCkIfNew() {
  const ck = readCk($request.headers);
  if (!ck) return "";
  const old = $persistentStore.read(CK_KEY) || "";
  if (ck !== old) {
    // 修改原因(2026-11-21审阅): 写入失败时不应谎报「已捕获」
    if ($persistentStore.write(ck, CK_KEY)) {
      $notification.post("京东CK已捕获", "", "京粉转链可用（APP 抓的 CK 有效期约 90 天）");
    }
  }
  return ck;
}

function notify(title, text, openUrl) {
  if (openUrl) $notification.post(title, "", text, { openUrl });
  else $notification.post(title, "", text);
}

function diagNotify(title, text, key) {
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

function publish(shareUrl, sku, onDone) {
  const dedupId = sku || shareUrl;
  // 修改原因(2026-11-21审阅): 转链前就写冷却——失败/无返利/无CK 的通知同样去重，并发响应不会全部穿透
  if (isDupAndMark(dedupId)) {
    if (onDone) onDone();
    return;
  }
  convert(shareUrl, (r) => {
    try {
      notify("京粉转链", r.msg, r.link ? jumpScheme(r.link) : "");
    } catch (e) {
      console.log("jd_jingfen notify error: " + String(e));
    } finally {
      if (onDone) onDone();
    }
  });
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
// 修改原因(2026-11-21审阅): 用 typeof 判请求路径，避免未注入 $response 时 ReferenceError
if (typeof $response === "undefined") {
  // 路径 1：请求——只有目标接口才动手
  // 修改原因(2026-11-22审阅): 非目标流量零通知零改动——抓 CK 也收敛到目标接口
  //   （商品/配置请求都带 Cookie，抓取时机不受影响），避免任意 JD 流量触发写库+弹窗
  // 修改原因(2026-11-22#2): 命中面加上 RE_FLOORS（进商品页的明文 sku 来源）
  if (RE_PRODUCT.test(url) || RE_CONFIG.test(url) || RE_FLOORS.test(url)) {
    try {
      saveCkIfNew();
    } catch (e) {} // 修改原因(2026-11-21): 抓 CK 出错也不能断连
    // 修改原因(2026-11-22): 目标商品接口弹请求心跳（证明请求侧规则+脚本执行通），其余静默
    if (DEBUG_PING && RE_PRODUCT.test(url)) {
      diagNotify("京粉转链｜心跳REQ", "请求侧链路通✓ " + url.slice(0, 60), DIAG_KEY_REQ);
    }
  }

  // 修改原因(2026-11-22#2): 进商品页第二触发点——wareDetailAsyncFloors 请求体带明文 skuId。
  //   先 $done 放行再异步转链：楼层请求不被转链网络耗时拖慢；若 Loon 在 $done 后终止上下文，
  //   最坏也只是这条线不出通知（页面不受影响），详情页/商品页另两条线仍有覆盖
  if (RE_FLOORS.test(url)) {
    const sku = skuFromBody($request.body || "");
    if (sku) {
      if (DEBUG_PING) diagNotify("京粉转链｜心跳楼层", "wareDetailAsyncFloors 命中✓ sku=" + sku, DIAG_KEY_REQ);
      // 修改原因(2026-11-22#2审阅): Loon 不保证 $done 之后上下文还活着，改成转链完成再放行；
      //   加 3 秒保底定时释放，且 released 闸门保证 $done 恰好一次，转链异常也不会挂住页面楼层
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        $done({});
      };
      setTimeout(release, 3000);
      publish(itemUrlOf(sku), sku, release);
      return;
    }
  }
  $done({}); // 修改原因(2026-11-21审阅): Loon 无参 $done() 会断开请求，必须 {} 原样放行
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
    if (!RE_PRODUCT.test(url)) {
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
