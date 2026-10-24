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
//
// 模块分类 · 使用方式
// - Surge → 脚本 → 新建 → 类型选「HTTP Request」
// - 正则：^https:\/\/mxx\.client\.10010\.com(?::443)?\/servicequerybusiness\/(.+)
// - 触发路径：联通 App 内打开「余量查询」页
//
// 模块分类 · 日志与边界
// - 全程不输出 Cookie 明文；只输出长度、key 数、是否含登录态字段
// - 任何异常都只 console.log，不阻塞请求（$done({}) 透传）
// =====================================================================

const BOX_KEY = "ComponentService";                  // BoxJS 持久化根 key
const SERVICE_PATH = "ChinaUnicom.Settings.Cookie"; // 子路径
const LOGIN_TOKEN_RE = /(?:^|;)\s*ecs_token\s*=[^;\s]+/;

// BoxJS 地址（与小组件 settings.boxJsUrl 默认值一致）
const BOXJS_BASE = "https://boxjs.com";

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

/**
 * 读取 BoxJS 的 ComponentService 根对象
 * 返回 { root, cookie }：root 是完整对象（用于整写时保留其他服务）
 */
function readBoxRoot() {
  return new Promise((resolve) => {
    $httpClient.get(
      {
        url: BOXJS_BASE + "/query/data/" + encodeURIComponent(BOX_KEY),
        headers: { Accept: "application/json" },
        timeout: 10,
      },
      (err, resp, body) => {
        if (err || !body) {
          console.log("⚠️ 联通CK | 读取 BoxJS 失败：" + String(err || "empty body"));
          resolve({ root: {}, cookie: "" });
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
          console.log("⚠️ 联通CK | 读取 BoxJS 解析失败：" + String(e));
          resolve({ root: {}, cookie: "" });
        }
      }
    );
  });
}

/**
 * 写入 Cookie 到 BoxJS（POST /api/saveData，body {key, val}）
 * val 必须是 JSON 字符串，与 BoxJS /query/data 返回的形状一致
 */
function writeBoxCookie(root) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ key: BOX_KEY, val: JSON.stringify(root) });
    $httpClient.post(
      {
        url: BOXJS_BASE + "/api/saveData",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: payload,
        timeout: 10,
      },
      (err, resp, body) => {
        if (err) {
          console.log("⚠️ 联通CK | 写入 BoxJS 失败：" + String(err));
          resolve(false);
          return;
        }
        resolve(true);
      }
    );
  });
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

  const { root, cookie: current } = await readBoxRoot();

  if (current === cookie) {
    // 值未变化：静默透传，避免每次请求都弹通知
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
    console.log("✅ 联通CK | 已写入 " + BOX_KEY + "." + SERVICE_PATH + " | " + summarize(cookie));
    $notification.post("中国联通", "Cookie 已更新", "写入 " + BOX_KEY + "." + SERVICE_PATH);
  } else {
    $notification.post("中国联通", "Cookie 写入失败", "请检查网络或 BoxJS 地址");
  }

  // http-request 脚本必须透传请求本体，否则会打断联通 App 正常请求
  $done({});
}

main();
