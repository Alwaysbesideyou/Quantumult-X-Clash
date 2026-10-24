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
// 模块分类 · 关键实现决策（2026-10-24 修订）
// - 旧方案：$httpClient POST https://boxjs.com/api/saveData
//   问题1：boxjs.com 是假域名，必须靠 BoxJS 官方模块的 rewrite 接管，//          而 Surge 脚本内 $httpClient 请求默认跳过 rewrite
//   问题2：即使 rewrite 未生效，请求也可能返回 200 + HTML 页面，
//           导致旧脚本误判成功并弹出"已更新"通知（假通知）
//   问题3：MITM 需额外覆盖 boxjs.com，链路长、失败点
// - 新方案：直接写 $persistentStore
//   BoxJS 官方 EnvJs 在 Surge 环境下的 setval 就是 $persistentStore.write，
//   两者共用同一份存储。直写可完全绕开 rewrite / MITM / HTTP，
//   且返回值即刻可知，不会再出现假通知
//
// 模块分类 · 目标
// - 抓到的 Cookie 必须包含 ecs_token（登录态判据）
// - 写入 ComponentService.ChinaUnicom.Settings.Cookie
// - 保留 ComponentService 下其他服务的数据（12123/ChinaBroadnet/SGCC）
// - 与已有值做去重，避免每次请求都触发一次系统通知
// - 以 $persistentStore.write 的返回值作为唯一成功判据
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
// 模块分类 · 日志与边界
// - 全程不输出 Cookie 明文；只输出长度、key 数、是否含登录态字段
// - 任何异常都只 console.log，不阻塞请求（$done({}) 透传）
// =====================================================================

const BOX_KEY = "ComponentService";                  // BoxJS/Surge 共用持久化根 key
const SERVICE_PATH = "ChinaUnicom.Settings.Cookie"; // 子路径
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

/** 读出 BoxJS 持久化的 ComponentService 根对象 */
function readBoxRoot() {
  try {
    const raw = $persistentStore.read(BOX_KEY);
    if (!raw) return { root: {}, cookie: "" };
    const root = JSON.parse(raw);
    if (!root || typeof root !== "object") return { root: {}, cookie: "" };
    const cookie =
      root.ChinaUnicom && root.ChinaUnicom.Settings
        ? String(root.ChinaUnicom.Settings.Cookie || "").trim()
        : "";
    return { root, cookie };
  } catch (e) {
    console.log("⚠️ 联通CK | 读取持久化数据失败：" + String(e));
    return { root: {}, cookie: "" };
  }
}

/** 写回 BoxJS 持久化数据，以 write 返回值为唯一成功判据 */
function writeBoxRoot(root) {
  // 只更新 ChinaUnicom.Settings.Cookie，保留其他服务
  if (!root.ChinaUnicom || typeof root.ChinaUnicom !== "object") root.ChinaUnicom = {};
  if (!root.ChinaUnicom.Settings || typeof root.ChinaUnicom.Settings !== "object") {
    root.ChinaUnicom.Settings = {};
  }
  root.ChinaUnicom.Settings.Cookie = lastCookie;

  const written = $persistentStore.write(JSON.stringify(root), BOX_KEY);

  // 回读校验：确保真的落库了
  const verify = readBoxRoot().cookie;
  const ok = written === true && verify === lastCookie;
  if (!ok) {
    console.log(
      "⚠️ 联通CK | 写入校验失败 | write=" + String(written) +
      " readback=" + (verify ? "有值但不一致" : "空")
    );
  }
  return ok;
}

let lastCookie = "";

function main() {
  // 手动触发 / 编辑器运行：没有请求上下文，只报告状态
  if (typeof $request === "undefined") {
    const { cookie } = readBoxRoot();
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

  const { root, cookie: current } = readBoxRoot();

  if (current === cookie) {
    // 值未变化：静默透传，避免每次请求都弹通知
    console.log("ℹ️ 联通CK | 与现值一致，跳过写入");
    $done({});
    return;
  }

  lastCookie = cookie;
  const ok = writeBoxRoot(root);

  if (ok) {
    console.log("✅ 联通CK | 已写入 " + BOX_KEY + "." + SERVICE_PATH);
    $notification.post("中国联通", "Cookie 已更新", "写入 " + BOX_KEY + "." + SERVICE_PATH);
  } else {
    $notification.post("中国联通", "Cookie 写入失败", "详情见 Surge 脚本日志");
  }

  // http-request 脚本必须透传请求本体，否则会打断联通 App 正常请求
  $done({});
}

main();
