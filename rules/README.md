# 直连规则集（Clash / Loon）

用途：家庭服务【外网】+ Emby 公益服不走代理隧道（DIRECT）。内网服务不在这里——由你的泛域名 backHome 兜底。

## 文件
- `home.yaml` / `home.list` — 家庭服务外网（CF Pages/Workers + Azure VPS）
- `emby.yaml` / `emby.list` — Emby 公益服

## 订阅地址（首选：自家 CDN gh.7666665.xyz）
注意路径格式：`https://gh.7666665.xyz/https://raw.githubusercontent.com/<user>/<repo>/master/<path>`

- https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/home.yaml
- https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/home.list
- https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/emby.yaml
- https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/emby.list

备用（jsDelivr）：`https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/<file>`

## Clash 引用
```yaml
rule-providers:
  home-external:
    type: http
    behavior: classical
    format: yaml
    url: https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/home.yaml
    path: ./rule-providers/home.yaml
    interval: 86400
  emby:
    type: http
    behavior: classical
    format: yaml
    url: https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/emby.yaml
    path: ./rule-providers/emby.yaml
    interval: 86400
rules:
  - RULE-SET,home-external,DIRECT
  - RULE-SET,emby,DIRECT
  - DOMAIN-SUFFIX,7666665.xyz,backHome   # 泛域名兜底，必须放 RULE-SET 之后
```

## Loon 订阅（[Remote Rule] / 订阅规则）
```
https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/home.list,policy=DIRECT,enabled=true
https://gh.7666665.xyz/https://raw.githubusercontent.com/Alwaysbesideyou/Quantumult-X-Clash/master/rules/emby.list,policy=DIRECT,enabled=true
```
如果 Loon 对含 `://` 的路径解析异常，换 jsDelivr 两行：
```
https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/home.list,policy=DIRECT,enabled=true
https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/emby.list,policy=DIRECT,enabled=true
```
泛域名 backHome 那条要放这些订阅之后。

## 说明
- 增减规则：直接跟 Hermes 说一声，GitHub MCP 直改本目录文件，无需脚本
- 弃用项（CF Tunnel hac/bwc/nasc/subc、tmp-mail）不在清单里；sy/v2/wg 归泛域名
