// 用途：链路诊断——只弹通知，不动任何请求/响应；A=请求链路命中，B=商品页规则命中
$notification.post(
  "JD诊断命中✓",
  "",
  (typeof $response === "undefined" ? "A请求链路" : "B商品页规则") + " | " + $request.url.slice(0, 80)
);
$done({}); // http-request/http-response 都原样放行
