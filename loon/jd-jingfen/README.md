# 京粉自返利转链（Loon 版）

京东 APP 商品页自动转京粉推广链接，自己吃自己的返利。

- 进商品页 → 上方弹通知「💰返点 x%｜预计返利 ¥x」
- 点通知 → 经你的推广链接跳回京东 APP 该商品页 → 下单即自返利
- 京东 CK 自动抓取/刷新（APP 抓的 pt_key 有效期约 90 天），只存本机 Loon，不上传第三方
- 同一商品 10 分钟内不重复弹（脚本顶部 `DEDUP_MINUTES` 可调）

## 安装

1. 京粉 APP 下载并完成推客认证（返利要落到你的京粉/联盟账号，没认证转不出佣金）
2. Loon → 插件 → 添加远程插件，粘贴：

   ```
   https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@main/loon/jd-jingfen/jd_jingfen.lpx
   ```

3. 启用插件，并开启 MITM（证书安装+信任，`hostname = api.m.jd.com` 已在插件里）
4. 打开京东 APP →「我的」→ 签到页点一次签到（触发 CK 抓取，弹「京东CK已捕获」即成功）
   - 之后浏览商品页也会顺带补抓，基本无感
5. 打开任意商品页 → 等通知 → 点通知跳回商品页下单

## 排错

- **弹「还没抓到京东CK」**：回第 4 步再抓一次；确认 MITM 已开且证书已信任
- **弹「京粉登录态失效」(430)**：重新抓 CK；仍不行去京粉 APP 确认推客认证有效
- **弹「转链返回非 JSON」**：接口可能被京东改/风控，把 Loon 日志（脚本顶部 DEBUG=true）发出来
- **不弹通知**：同一商品 10 分钟去重；换别的商品页试
- 脚本只认 `wareBusiness / lite_wareBusiness / pingou_item` 等商品页接口；京东大改版换了 functionId 的话需要更新正则

## 文件

- `jd_jingfen_convert.js` — 主脚本（抓 CK + 转链 + 通知）
- `jd_jingfen.lpx` — Loon 插件（两条 Script + MITM hostname）

## 说明

- 参考老 QX 脚本 Tartarus2014/Script/jf_Convert.js 重写；老脚本转链分支仅 QX 生效，本版按 Loon 原生 API 实现
- 转链走京粉小程序接口 `ConvertSuperLink`（appid=u），非官方联盟开放平台 API，免 appKey 申请
- 自推自买违反京东联盟规则，低频自用风险自担
