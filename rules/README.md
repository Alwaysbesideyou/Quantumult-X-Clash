# 直连规则集（Clash / Loon）

用途：家庭服务【外网】+ Emby 公益服不走代理隧道（DIRECT）。内网服务不在这里——由你的泛域名 backHome 兜底。

## 文件
- `home.yaml` / `home.list` — 家庭服务外网（CF Pages/Workers + Azure VPS）
- `emby.yaml` / `emby.list` — Emby 公益服

## Clash 引用
```yaml
rule-providers:
  home-external:
    type: http
    behavior: classical
    format: yaml
    url: https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/home.yaml
    path: ./rule-providers/home.yaml
    interval: 86400
  emby:
    type: http
    behavior: classical
    format: yaml
    url: https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/emby.yaml
    path: ./rule-providers/emby.yaml
    interval: 86400
rules:
  - RULE-SET,home-external,DIRECT
  - RULE-SET,emby,DIRECT
  - DOMAIN-SUFFIX,7666665.xyz,backHome   # 泛域名兜底，必须放 RULE-SET 之后
```

## Loon 订阅（[Remote Rule] / 订阅规则）
```
https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/home.list,policy=DIRECT,enabled=true
https://cdn.jsdelivr.net/gh/Alwaysbesideyou/Quantumult-X-Clash@master/rules/emby.list,policy=DIRECT,enabled=true
```
同样：泛域名 backHome 那条要放这两个订阅之后。

## 说明
- 国内 raw.githubusercontent.com 拉不动时用 jsdelivr 地址（上面给的就是 jsdelivr）
- 增减规则：直接跟 Hermes 说一声，GitHub MCP 直改本目录文件，无需脚本
- 弃用项（CF Tunnel hac/bwc/nasc/subc、tmp-mail）不在清单里；sy/v2/wg 归泛域名
