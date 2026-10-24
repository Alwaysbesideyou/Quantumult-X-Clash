// =====================================================================
// 10010/unicom_cookie.js
//
// 模块分类 · 背景
// - 联通 App 新版登录态 Cookie 主要分发在 mxx.client.10010.com
// - 小组件（中国联通-小组件修改）通过 BoxJS HTTP API 读取 Cookie：
//     GET  https://boxjs.com/query/data/ComponentService
//     →   { key, val }  →  val 是 JSON 字符串
//          →  JSON.parse(val).ChinaUnicom.Settings.Cookie
// - 已实测 BoxJS 返回（2026-10-24）：
//     {"key":"ComponentService","val":"{\"12123\":{...},\"ChinaUnicom\":{\"Settings\":{\"Cookie\":\"\"},...}"}
//   ComponentService 根 key 下同时存放 12123 / ChinaUnicom / ChinaBroadnet / SGCC
//   等多个服务，写入时必须整读→改字段→整写，不能直接覆盖
//
// 模块分类 · 目标
// - 抓到的 Cookie 必须包含 ecs_token（登录态判据）
// - 写入路径与小组件读取路径严格一致，实现全自动同步
// - 保留 ComponentService 下其他服务的数据，只更新 ChinaUnicom.Settings.Cookie
// - 与已有值做去重，避免每次请求都触发一次系统通知
// - BoxJS 域名主备：boxjs.com 失败自动切 boxjs.net
// - 失败时输出 HTTP 状态码 + 响应体片段，便于定位
//
// 模块分类 · 使用方式
// - Surge → 脚本 → 新建 → 类型选「HTTP Request」
// - 正则：^https:\/\/mxx\.client\.10010\.com(?::443)?\/(servicequerybusiness|serviceimportantbusiness)\/(.+)
// - 触发路径（2026-10-24 抓包确认）：
//     /servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune
//       带 SHAREJSESSIONID + servicequerybusiness（按路径切分的服务级 session）
//     /serviceimportantbusiness/smart/smartwisdomCommonNew
//       带 JSESSIONID + serviceimportantbusiness（登录态最全的组合）
//
// 模块分类 · 前置条件
// - 必须安装 BoxJS 官方 Surge 模块，否则 boxjs.com 的请求不会交给
//   BoxJS 脚本处理，/api/saveData 会返回 HTML 页面而非 JSON
//   https://raw.githubusercontent.com/chavyleung/scripts/master/box/rewrite/boxjs.rewrite.surge.sgmodule
//
// 模块分类 · 日志与边界
// - 全程不输出 Cookie 明文；只输出长度、key 数、是否含登录态字段
// - 任何异常都只 console.log，不阻塞请求（$done({}) 透传）
// =====================================================================

const BOX_KEY = "ComponentService";                  // BoxJS 持久化根 key
const SERVICE_PATH = "ChinaUnicom.Settings.Cookie"; // 子路径
const LOGIN_TOKEN_RE = /(?:^|;)\s*ecs_token\s*=[^;\s]+/;

// BoxJS 域名主备（小组件默认读 boxjs.com，写入也用同一域名才能落到同一份数据）
const BOXJS_BASES = ["https://boxjs.com", "https://boxjs.net"];

/** 从请求头里取 Cookie（大小写不敏感） */
function readRequestCookie(request) {
  const headers = (request && request.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "cookie");
  return key ? String(headers[key] || "").trim() : "";
}

/** 只做安全摘要，绝不回显 Cookie 内容 */
function summarize(cookie) {
  const keys = cookie
    .split(";")
    .map((p) => p.split("=", 1)[0].trim())
    .filter(Boolean);
  const important = ["ecs_token", "t3_token", "third_token", "ecs_acc", "enc_acc", "c_mobile", "c_version", "login_type"];
  const present = important.filter((k) => keys.indexOf(k) >= 0);
  return "len=" + cookie.length + " keys=" + keys.length + " 已含=[" + present.join(",") + "]";
}

/** 响应体片段（截断，避免日志过长） */
function bodySnippet(body) {
  const s = String(body || "").replace(/\s+/g, " ").trim();
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

/**
 * 读取 BoxJS 的 ComponentService 根对象
 * 返回 { root, cookie, base }：root 是完整对象（用于整写时保留其他服务）
 */
async function readBoxRoot() {
  for (const base of BOXJS_BASES) {
    const result = await new Promise((resolve) => {
      $httpClient.get(
        {
          url: base + "/query/data/" + encodeURIComponent(BOX_KEY),
          headers: { Accept: "application/json" },
          timeout: 15,
        },
        (err, resp, body) => {
          if (err) {
            console.log("⚠️ 联通CK | 读取失败 " + base + " | " + String(err));
            resolve(null);
            return;
          }
          const status = resp && resp.status ? resp.status : 0;
          if (status !== 200) {
            console.log("⚠️ 联通CK | 读取 HTTP " + status + " " + base + " | " + bodySnippet(body));
            resolve(null);
            return;
          }
          try {
            const data = JSON.parse(body);
            let root = data && data.val;
            // BoxJS 的 val 是 JSON 字符串，需要再解析一次
            if (typeof root === "string") root = JSON.parse(root);
            if (!root || typeof root !== "object") root = {};
            const cookie =
              root.ChinaUnicom && root.ChinaUnicom.Settings
                ? String(root.ChinaUnicom.Settings.Cookie || "").trim()
                : "";
            resolve({ root, cookie });
          } catch (e) {
            console.log("⚠️ 联通CK | 读取解析失败 " + base + " | " + String(e) + " | " + bodySnippet(body));
            resolve(null);
          }
        }
      );
    });
    if (result) return result;
  }
  return { root: {}, cookie: "" };
}

/**
 * 写入 Cookie 到 BoxJS（POST /api/saveData，body {key, val}）
 * val 必须是 JSON 字符串，与 BoxJS /query/data 返回的形状一致
 */
async function writeBoxCookie(root) {
  const payload = JSON.stringify({ key: BOX_KEY, val: JSON.stringify(root) });
  for (const base of BOXJS_BASES) {
    const ok = await new Promise((resolve) => {
      $httpClient.post(
        {
          url: base + "/api/saveData",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: payload,
          timeout: 15,
        },
        (err, resp, body) => {
          if (err) {
            console.log("⚠️ 联通CK | 写入失败 " + base + " | " + String(err));
            resolve(false);
            return;
          }
          const status = resp && resp.status ? resp.status : 0;
          if (status !== 200) {
            console.log("⚠️ 联通CK | 写入 HTTP " + status + " " + base + " | " + bodySnippet(body));
            resolve(false);
            return;
          }
          resolve(true);
        }
      );
    });
    if (ok) {
      console.log("✅ 联通CK | 写入成功 " + base);
      return true;
    }
  }
  return false;
}

async function main() {
  // 手动触发 / 编辑器运行：没有请求上下文，只报告状态
  if (typeof $request === "undefined") {
    const { cookie } = await readBoxRoot();
    console.log(
      cookie
        ? "ℹ️ 联通CK | 手动运行 | 已有 Cookie：" + summarize(cookie)
        : "ℹ️ 联通CK | 手动运行 | 尚无 Cookie，请在联通 App 内进入余量查询页"
    );
    $done({});
    return;
  }

  const cookie = readRequestCookie($request);

  if (!cookie) {
    console.log("ℹ️ 联通CK | 请求无 Cookie 字段，跳过");
    $done({});
    return;
  }

  if (!LOGIN_TOKEN_RE.test(cookie)) {
    console.log("ℹ️ 联通CK | 未含 ecs_token，跳过（" + summarize(cookie) + "）");
    $done({});
    return;
  }

  console.log("🔎 联通CK | 抓到 Cookie：" + summarize(cookie));

  const { root, cookie: current } = await readBoxRoot();

  if (current === cookie) {
    // 值未变化：静默透传，避免每次请求都弹通知
    console.log("ℹ️ 联通CK | 与 BoxJS 现值一致，跳过写入");
    $done({});
    return;
  }

  // 只更新 ChinaUnicom.Settings.Cookie，保留 ComponentService 下其他服务
  if (!root.ChinaUnicom || typeof root.ChinaUnicom !== "object") root.ChinaUnicom = {};
  if (!root.ChinaUnicom.Settings || typeof root.ChinaUnicom.Settings !== "object") {
    root.ChinaUnicom.Settings = {};
  }
  root.ChinaUnicom.Settings.Cookie = cookie;

  const ok = await writeBoxCookie(root);
  if (ok) {
    $notification.post("中国联通", "Cookie 已更新", "写入 " + BOX_KEY + "." + SERVICE_PATH);
  } else {
    $notification.post("中国联通", "Cookie 写入失败", "请检查是否已安装 BoxJS 官方 Surge 模块");
  }

  // http-request 脚本必须透传请求本体，否则会打断联通 App 正常请求
  $done({});
}

main();
