/*
 * 京粉自返利转链（Loon 版）
 * 用途：京东 APP 内自动抓京东 CK + 商品页自动京粉转链，弹通知，点击跳回京东 APP 商品页。
 * 原理参考老 QX 脚本 Tartarus2014/Script/jf_Convert.js；该脚本在 Loon 上转链分支被
 *   `if (!isQuanX) 放行` 提前退出，本脚本按 Loon 原生 API 重写两条路径：
 *   1) http-request：从 api.m.jd.com 请求头 Cookie 提取 pt_key/pt_pin 存入本地（有效期约90天）
 *   2) http-response：商品页接口响应里抽 shareUrl → 调京粉 ConvertSuperLink 转链 → 弹通知
 * 隐私：CK 只存 Loon $persistentStore，不上传任何第三方；转链请求直发 api.m.jd.com。
 * 注意：自推自买违反京东联盟规则，低频自用风险自担。
 */

// ===== 可调配置 =====
const EXT1 = "200|100_3|";          // 京粉推广位参数（老脚本沿用值）
const DEDUP_MINUTES = 10;           // 同一商品在该时长内不重复弹通知
const DEBUG = false;                // true 时在 Loon 日志里打印转链原始返回
// ===================

const CK_KEY = "jd_jf_cookie";
const DEDUP_KEY = "jd_jf_last";
const WX_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN";
const WX_REFERER = "https://servicewechat.com/wxf463e50cd384beda/114/page-frame.html"; // 京粉小程序

const url = $request.url;

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

function notify(title, body, openUrl) {
  if (openUrl) $notification.post(title, "", body, { openUrl });
  else $notification.post(title, "", body);
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
      if (error) {
        cb({ msg: "转链请求失败：" + error });
        return;
      }
      let d;
      try {
        d = JSON.parse(data);
      } catch (e) {
        cb({ msg: "转链返回非 JSON，接口可能已变动" });
        return;
      }
      if (DEBUG) console.log("ConvertSuperLink: " + data);
      if (d.code === 200 && d.data) {
        if (d.data.promotionUrl) {
          cb({
            msg: `💰返点 ${d.data.wlCommissionShare}%｜预计返利 ¥${d.data.wlCommission}`,
            link: d.data.promotionUrl,
          });
        } else {
          cb({ msg: "该商品暂无返利" + (d.data.formatContext ? "：" + String(d.data.formatContext).trim() : "") });
        }
      } else if (d.code === 105) {
        cb({ msg: "京喜/极速版链接不支持此转链" });
      } else if (d.code === 430) {
        cb({ msg: "京粉登录态失效：重新抓一次 CK，或检查是否已在京粉完成推客认证" });
      } else {
        cb({ msg: "转链失败：" + String(d.message || JSON.stringify(d)).slice(0, 120) });
      }
    }
  );
}

// ---------- 入口 ----------
// 修改原因(2026-11-21审阅): 用 typeof 判请求路径，避免未注入 $response 时 ReferenceError
if (typeof $response === "undefined") {
  // 路径 1：请求头抓 CK（签到接口触发）
  saveCkIfNew();
  $done({}); // 修改原因(2026-11-21审阅): Loon 无参 $done() 会断开请求，必须 {} 原样放行
} else {
  // 路径 2：商品页/配置接口响应
  const body = $response.body;
  saveCkIfNew(); // 浏览商品页时顺带补抓 CK，免专门去签到

  if (url.includes("serverConfig") || url.includes("basicConfig")) {
    // 清掉 httpdns 配置，防止京东 APP 走 HTTPDNS 绕过 Loon MITM（沿用老脚本做法）
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
      $done({ body: JSON.stringify(obj) });
    } catch (e) {
      $done({ body });
    }
  } else {
    // 商品页：去重后转链弹通知，原样放行响应体
    let obj = null;
    try {
      obj = JSON.parse(body);
    } catch (e) {}
    const shareUrl = extractShareUrl(obj, body);
    const sku = skuOf(shareUrl);
    const dedupId = sku || shareUrl; // 修改原因(2026-11-21审阅): SKU 缺失时用链接兜底，保证去重生效
    let skip = false;
    try {
      const last = JSON.parse($persistentStore.read(DEDUP_KEY) || "{}");
      skip = dedupId && last.id === dedupId && Date.now() - last.ts < DEDUP_MINUTES * 60000;
    } catch (e) {}
    if (!shareUrl || skip) {
      $done({ body });
    } else {
      // 修改原因(2026-11-21审阅): 转链前就写冷却时间——失败/无返利/无CK 的通知同样去重，
      //   且并发响应不会全部穿透；所有结果共用 DEDUP_MINUTES 冷却
      $persistentStore.write(JSON.stringify({ id: dedupId, ts: Date.now() }), DEDUP_KEY);
      convert(shareUrl, (r) => {
        notify("京粉转链", r.msg, r.link ? jumpScheme(r.link) : "");
        $done({ body });
      });
    }
  }
}
