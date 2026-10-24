// =====================================================================
// 10010/unicom_cookie.js
//
// 模块分类 · 背景
// - 联通 App 新版登录态 Cookie 主要分发在 mxx.client.10010.com
// - 小组件（中国联通-小组件修改）通过 BoxJS HTTP API 读取 Cookie：
//     GET  https://boxjs.com/query/data/ComponentService
//     →   { key, val }  →  val.ChinaUnicom.Settings.Cookie
// - 因此本脚本必须写到同一个 BoxJS 持久化位置，否则小组件读不到
//   （BoxJS 的 setdata 会把 `ComponentService` 作为根 key 持久化，
//     子路径 ChinaUnicom.Settings.Cookie 存在同一个 JSON 里）
//
// 模块分类 · 目标
// - 抓到的 Cookie 必须包含 ecs_token（登录态判据）
// - 写入路径与小组件读取路径严格一致，实现全自动同步
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

const BOX_KEY = "ComponentService";          // BoxJS 持久化根 key
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

/** 读取 BoxJS 中已存的 Cookie（走 /query/data，与小组件同路径） */
function readBoxJsCookie() {
  return new Promise((resolve) => {
    $httpClient.get(
      {
        url: BOXJS_BASE + "/query/data/" + encodeURIComponent(BOX_KEY),
        headers: { Accept: "application/json" },
        timeout: 10,
      },
      (err, resp, body) => {
        if (err || !body) {
          resolve("");
          return;
        }
        try {
          const data = JSON.parse(body);
          let root = data && data.val;
          if (typeof root === "string") root = JSON.parse(root);
          const cookie = root && root.ChinaUnicom && root.ChinaUnicom.Settings
            ? String(root.ChinaUnicom.Settings.Cookie || "")
            : "";
          resolve(cookie.trim());
        } catch (e) {
          console.log("⚠️ 联通CK | 读取 BoxJS 解析失败：" + String(e));
          resolve("");
        }
      }
    );
  });
}

/** 写入 Cookie 到 BoxJS（POST /api/saveData，body {key, val}） */
function writeBoxJsCookie(cookie) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ key: BOX_KEY, val: cookie });
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
        console.log("✅ 联通CK | 已写入 " + BOX_KEY + "." + SERVICE_PATH + " | " + summarize(cookie));
        resolve(true);
      }
    );
  });
}

function notify(title, subtitle, content) {
  $notification.post(title, subtitle, content);
}

async function main() {
  // 手动触发 / 编辑器运行：没有请求上下文，只报告状态
  if (typeof $request === "undefined") {
    const current = await readBoxJsCookie();
    console.log(
      current
        ? "ℹ️ 联通CK | 手动运行 | 已有 Cookie：" + summarize(current)
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

  const current = await readBoxJsCookie();
  if (current === cookie) {
    // 值未变化：静默透传，避免每次请求都弹通知
    $done({});
    return;
  }

  const ok = await writeBoxJsCookie(cookie);
  if (ok) {
    notify("中国联通", "Cookie 已更新", "写入 " + BOX_KEY + "." + SERVICE_PATH);
  } else {
    notify("中国联通", "Cookie 写入失败", "请检查网络或 BoxJS 地址");
  }

  // http-request 脚本必须透传请求本体，否则会打断联通 App 正常请求
  $done({});
}

main();
