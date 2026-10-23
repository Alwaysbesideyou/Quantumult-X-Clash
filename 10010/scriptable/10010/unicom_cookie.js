// =====================================================================
// 10010/unicom_cookie.js
//
// 模块分类 · 背景
// - 联通 App 新版登录态 Cookie 主要分发在 mxx.client.10010.com
// - 本脚本从该域任意请求头里抓取完整 Cookie，写入 Surge persistentStore
//   的 `ComponentService` 根 key（与 BoxJS 的 #ComponentService 持久化键同名）
// - Scripting 小组件（中国联通-小组件修改）通过 BoxJS
//   /query/data/ComponentService 读取 ChinaUnicom.Settings.Cookie
//
// 模块分类 · 目标
// - 抓到的 Cookie 必须包含 ecs_token（登录态判据）
// - 与已有值做去重，避免每次请求都触发一次系统通知
// - 只写 ChinaUnicom.Settings.Cookie，不动同一 key 下的其他服务
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

const BOX_ROOT_KEY = "ComponentService"; // Surge $persistentStore 的 key
const SERVICE_KEY = "ChinaUnicom";
const LOGIN_TOKEN_RE = /(?:^|;)\s*ecs_token\s*=[^;\s]+/;

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

/** 读出已持久化的 BoxJS 根对象 */
function readBoxRoot() {
  try {
    const raw = $persistentStore.read(BOX_ROOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.log("⚠️ 联通CK | BoxJS 根对象解析失败，按空对象重写：" + String(e));
    return {};
  }
}

/** 写回 BoxJS 根对象，只更新 ChinaUnicom.Settings.Cookie */
let lastCookie = "";

function writeBoxRoot(root) {
  if (!root[SERVICE_KEY] || typeof root[SERVICE_KEY] !== "object") root[SERVICE_KEY] = {};
  if (!root[SERVICE_KEY].Settings || typeof root[SERVICE_KEY].Settings !== "object") {
    root[SERVICE_KEY].Settings = {};
  }
  root[SERVICE_KEY].Settings.Cookie = lastCookie;
  $persistentStore.write(JSON.stringify(root), BOX_ROOT_KEY);
}

function main() {
  // 手动触发 / 编辑器运行：没有请求上下文，只报告状态
  if (typeof $request === "undefined") {
    const existing = readBoxRoot();
    const current = existing[SERVICE_KEY] && existing[SERVICE_KEY].Settings
      ? String(existing[SERVICE_KEY].Settings.Cookie || "")
      : "";
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

  const root = readBoxRoot();
  const current = root[SERVICE_KEY] && root[SERVICE_KEY].Settings
    ? String(root[SERVICE_KEY].Settings.Cookie || "")
    : "";

  if (current === cookie) {
    // 值未变化：静默透传，避免每次请求都弹通知
    $done({});
    return;
  }

  lastCookie = cookie;
  writeBoxRoot(root);
  console.log("✅ 联通CK | 已写入 " + BOX_ROOT_KEY + "." + SERVICE_KEY + ".Settings.Cookie | " + summarize(cookie));

  $notification.post(
    "中国联通",
    "Cookie 已更新",
    "写入 " + BOX_ROOT_KEY + "." + SERVICE_KEY + ".Settings.Cookie"
  );

  // http-request 脚本必须透传请求本体，否则会打断联通 App 正常请求
  $done({});
}

main();
