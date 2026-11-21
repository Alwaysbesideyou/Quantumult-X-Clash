// 用途：链路诊断 v2——弹通知标注「请求/响应 + 有无body」，不动任何请求/响应
const hasBody =
  typeof $response !== "undefined" && typeof $response.body === "string" && $response.body.length > 0;
$notification.post(
  "JD诊断命中✓",
  "",
  (typeof $response === "undefined" ? "REQ" : "RESP") +
    (hasBody ? "有body" : "无body") +
    " | " +
    $request.url.slice(0, 110)
);
$done({}); // 原样放行
