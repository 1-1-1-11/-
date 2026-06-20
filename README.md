# OpenClaw 微信咖啡比价助手

本项目是一个本机 Windows 常驻的咖啡查价工具骨架：微信私聊进入 OpenClaw，OpenClaw 调用 `coffee_price_search`，工具按常用地址返回附近主流连锁咖啡的外卖到手价和自取价榜单。

第一版不自动下单，不扫非品牌小店，不保存平台密码。平台验证码、登录失效、门店无货时会明确返回原因，不编造价格。

## 当前实现

- `coffee_price_search` OpenClaw tool plugin
- 微信消息文本解析：如 `查公司附近冰美式`、`查咖啡 冰美式 两杯`
- 本地配置读取：地址、品牌池、渠道开关、独立浏览器 profile 路径
- 本地价格库 provider：默认启用 `config/pricebook.json`，不打开外卖 H5 页面即可返回可比榜单
- 城市参考价 provider：无 token 时也能给出星巴克/瑞幸/库迪的非实时横向参考
- 外部源 provider：`externalSources` 可以桥接授权查价 API、MCP/CLI 工具、HTTP 服务或自有券源脚本
- 瑞幸官方 MCP 设置器：`luckin:setup` 可导入 token、启用外部源、检查 readiness 并刷新价格库
- 统一渠道快照适配器：美团/饿了么/品牌官方页面提取结果先归一成 snapshot，再排序
- 浏览器页面提取器：用独立 profile 打开页面，按 CSS 选择器识别登录/验证码/无货，并提取价格候选
- 最低价购买页打开：配置开启后会在本机默认浏览器打开最低价候选的 `http/https` 购买页
- 外卖和自取分别 Top 3，价格包含商品、配送、包装和优惠拆解
- 本地 CLI：`npm run coffee -- "查公司附近冰美式" --config config/coffee-price.config.json`

## 初始化

```powershell
npm install
Copy-Item config/coffee-price.config.example.json config/coffee-price.config.json
```

编辑 `config/coffee-price.config.json`，把 `addresses` 改成你的常用地址。若要接入瑞幸官方 MCP，地址还需要填写 `longitude` 和 `latitude`，因为官方门店查询按经纬度查附近门店。

默认配置走本地价格库：

```powershell
npm run coffee -- "查公司附近冰美式"
npm run coffee -- "查咖啡 冰美式 两杯"
npm run coffee -- "查公司附近拿铁 大杯"
```

`config/pricebook.json` 是第一版可用数据源。它适合接入你自己维护的券源、群里收集的低价、品牌官方活动价，或者外部 MCP/脚本写入的结果。每条 offer 支持按 `addressAliases` 或 `addressQueries` 限定地址，支持外卖/自取、配送费、包装费、优惠拆解和购买链接。

如果配置里还没有 `browserSources`，可以先生成三个启用渠道的 selector 模板：

```powershell
npm run config:scaffold -- --config config/coffee-price.config.json --write
```

脚手架只补缺失渠道，不覆盖已有 selector；生成的 `example.com` 入口 URL 必须在真实平台校准后替换。

拿到真实平台搜索页或店铺页后，可以用下面的命令写入入口 URL。它会自动启用对应渠道，保留已有 selector；如果该渠道还没有 `browserSources`，会先补模板再写 URL：

```powershell
npm run config:set-url -- --source meituan --url "https://example.com/replace-with-real-platform-page" --write
```

注意：这里说的 `powershell` 是 Windows PowerShell 5.1。如果你用 PowerShell 7，命令入口通常是 `pwsh`，脚本本身两者都可以运行。

## 本地验证

默认可用验证不访问真实平台，只读取本地价格库：

```powershell
npm run coffee -- "查公司附近冰美式"
```

示例快照也不会访问真实平台，只用于验证 snapshot 查价链路：

```powershell
Copy-Item config/snapshots/meituan.example.json config/snapshots/meituan.json
npm run coffee -- "查公司附近冰美式" --config config/coffee-price.config.json --snapshot-meituan config/snapshots/meituan.json
```

验收前先跑本机环境诊断：

```powershell
npm run doctor
```

`doctor` 会检查 OpenClaw Gateway、`coffee-price` 配置路径、微信插件启用状态、微信扫码登录状态、私聊会话隔离和 `https://ilinkai.weixin.qq.com` HTTPS 通路。返回 `FAIL` 时，不要做微信私聊验收；先按报告里的失败项处理。

## OpenClaw 接入

先构建并生成插件元数据：

```powershell
npm run plugin:build
npm run plugin:validate
```

安装/启用 OpenClaw 微信 channel：

```powershell
.\scripts\install-openclaw-wechat.ps1 -Login
```

脚本会安装 OpenClaw CLI、安装本项目 `coffee-price` 插件、安装 `@tencent-weixin/openclaw-weixin`、启用 `openclaw-weixin` channel，并在 `-Login` 时启动微信 QR 登录。
因为当前项目路径包含中文，脚本会创建 `C:\Users\32299\.openclaw\coffee-price-project` 这个 ASCII junction，并修复 OpenClaw Gateway 的 Scheduled Task wrapper，避免 Windows `.cmd` 把中文路径写成乱码。

如果首次安装时微信 QR 登录没有打开，重新运行这个专用登录脚本：

```powershell
.\scripts\start-weixin-login.ps1
```

它会为当前登录命令注入 `scripts/openclaw-network-preload.mjs`，避免本机 TUN/fake-ip DNS 把 `ilinkai.weixin.qq.com` 解析到 `198.18.*` 后导致 TLS 重置。

如果 OpenClaw 官方登录命令在 Windows PowerShell 5.1 里没有显示二维码，可以用本项目的直连登录 fallback：

```powershell
npm run weixin:login
```

这条命令会直接请求微信 iLink 二维码，扫码成功后把账号 token 写入 `C:\Users\32299\.openclaw\state\openclaw-weixin`，并更新 `C:\Users\32299\.openclaw\openclaw.json` 里的 `channels.openclaw-weixin.channelConfigUpdatedAt`，让 Gateway 重新加载微信 channel 配置。它不保存微信密码，也不绕过验证码；如果 `npm run doctor` 之后仍显示微信未登录，再运行 `npx openclaw gateway restart`。

如果 Windows PowerShell 5.1 终端里的二维码链接不方便复制，可以把链接写入文件：

```powershell
npm run weixin:login -- --open-qr --qr-url-file .runtime/weixin-login/qr-url.txt --qr-html-file .runtime/weixin-login/qr.html
```

命令启动后会尝试用默认浏览器打开二维码链接，同时把链接写入文本文件和本地 HTML 页面；如果浏览器没有自动打开，就双击 `.runtime/weixin-login/qr.html` 或打开文本文件里的链接再扫码。文件只保存二维码链接，不保存 token 或密码。

OpenClaw 官方文档当前说明微信 channel 是外部插件，支持私聊和媒体，群聊能力未在插件能力元数据中声明。因此本项目第一版按微信私聊设计。

## OpenClaw 插件配置

推荐直接使用上面的安装脚本。手动配置时，不要把中文项目路径写进 OpenClaw 配置；使用脚本创建的 ASCII junction 路径：

```powershell
openclaw plugins install C:\Users\32299\.openclaw\coffee-price-project --force
openclaw config set plugins.entries.coffee-price.enabled true
openclaw config set plugins.entries.coffee-price.config.configPath "C:\Users\32299\.openclaw\coffee-price-project\config\coffee-price.config.json"
openclaw config set plugins.entries.coffee-price.config.snapshotPaths.meituan "C:\Users\32299\.openclaw\coffee-price-project\config\snapshots\meituan.json"
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
```

真实自动查价时，后续要把美团、饿了么、品牌官方页面自动化提取层接到同一个 snapshot 格式。现在的 snapshot 适配器已经把“登录失效/验证码/无货/可比候选”边界固定住。

## 本地价格库与 MCP 源

默认运行配置启用 `sources.priceBook` 和 `sources.cityBenchmark`，关闭 `meituan`、`eleme`、`brandOfficial` 网页源。这样微信触发时不会卡在网页登录、人机验证或 403 风控上，而是先用 `config/pricebook.json` 返回已知低价，再用城市参考价补齐星巴克/瑞幸/库迪横向对比。价格库结构示例：

```json
{
  "source": "priceBook",
  "updatedAt": "2026-06-21T00:00:00+08:00",
  "offers": [
    {
      "addressAliases": ["公司"],
      "brand": "瑞幸",
      "storeName": "瑞幸 示例门店",
      "drinkName": "冰美式",
      "normalizedDrink": "americano",
      "size": "中杯",
      "fulfillment": "pickup",
      "itemPrice": 12.9,
      "discounts": [{ "label": "示例券", "amount": 4 }],
      "purchaseUrl": "https://lkcoffee.com/"
    }
  ]
}
```

`cityBenchmark` 是无 token 兜底源，价格逻辑参考 ClawHub 的 Coffee Prices by City：按城市分级和品牌基础价输出参考价。它适合在没有瑞幸 token、没有外卖平台登录态时做品牌横向比较；它不是门店实时售价，不包含配送费、门店库存、平台券和购买页。

`externalSources` 用于接授权接口、MCP/CLI 工具、云手机服务或自有券源。命令行模式会把 `{ query, address }` JSON 写入外部命令的 stdin，并要求 stdout 返回一个 `PlatformSnapshot` JSON。示例：

```json
{
  "externalSources": [
    {
      "id": "mcp-price-feed",
      "label": "MCP 查价源",
      "enabled": true,
      "type": "command",
      "command": "node",
      "args": ["scripts/example-external-price-source.mjs"],
      "timeoutMs": 30000
    }
  ]
}
```

HTTP 模式会用 `POST` 发送同一个 JSON 请求体，响应可以直接是 `PlatformSnapshot`，也可以包在 `data`、`result` 或 `snapshot` 字段中：

```json
{
  "externalSources": [
    {
      "id": "orderwise-http",
      "label": "云手机外卖比价 HTTP",
      "enabled": true,
      "type": "http",
      "url": "http://127.0.0.1:18080/coffee-price/search",
      "timeoutMs": 120000,
      "bearerTokenEnv": "COFFEE_PRICE_HTTP_TOKEN"
    }
  ]
}
```

HTTP 源适合接 OrderWise、meituan-cli 这类云手机/App 自动化服务，或者你自己的本地价格聚合 API。请求头可以用 `headers` 写固定值；敏感 token 优先用 `bearerTokenEnv` 或 `bearerTokenFile`，不要写进 Git 仓库。这个桥接层不要求外部源一定是网页抓取；只要输出统一 snapshot，排序和微信回复逻辑就会复用同一套代码。

### 美团 App 自动化源

公开项目 [meituan-cli](https://github.com/oscarka/meituan-cli) 的思路是用 Android 真机/模拟器 + UIAutomator2 控制已登录的美团 App，并暴露本地 HTTP API，而不是抓 H5 或逆向协议。它的 README 中列出的业务端点包括 `/search`、`/open`、`/tap?keyword=外卖`、`/type`、`/add_to_cart`、`/cart`、`/checkout`；`checkout` 停在确认订单页，不会自动付款。

本项目提供 `meituan:app-source` 把这组端点转换成统一 `PlatformSnapshot`：

```powershell
npm run meituan:app-source
```

它作为 `externalSources` 命令运行时会从 stdin 读取 `{ query, address }`，对配置的品牌逐个执行 App 自动化报价，最后输出外卖到手价候选。默认连接 `http://127.0.0.1:18080`，默认品牌池为瑞幸、库迪、星巴克、Tims、Manner、M Stand、Peet's。可以用参数或环境变量调整：

```powershell
npm run meituan:app-source -- --base-url "http://127.0.0.1:18080" --brands "瑞幸,库迪,星巴克"
```

示例配置已包含一个禁用的 `meituanApp` 外部源。启动 meituan-cli 服务并确认手机已登录美团后，把它改成 `enabled: true`，再运行：

```powershell
npm run pricebook:refresh -- --query "查公司附近冰美式"
```

现场检查用：

```powershell
npm run meituan:doctor
```

它会分别检查 ADB、Android 设备授权状态、`http://127.0.0.1:18080/state` 服务和 `externalSources.meituanApp` 配置。Windows 上如果 `winget` 安装了 `Google.PlatformTools` 但当前 shell 还找不到 `adb`，doctor 会自动尝试常见 winget 安装目录；也可以用 `MEITUAN_ADB_PATH` 或 `--adb` 显式指定。

启动 HTTP 控制服务用：

```powershell
npm run meituan:serve
```

它默认使用 `.runtime\meituan-cli\.venv\Scripts\python.exe` 和 `.runtime\meituan-cli\cli.py`，并把 winget 常见 ADB 目录临时加入子进程 `PATH`。如果你的 meituan-cli 或 Python 虚拟环境放在其他位置，可以传 `--repo`、`--python`、`--adb`、`--port`。

边界：这个路径避免的是网页 H5 登录/验证码问题；它依赖一台已登录且解锁的 Android 设备或云手机。如果美团 App 自身弹出滑块验证、起送价不足、地址未配置或页面结构改变，适配器会返回明确失败原因，不会猜价格，也不会自动付款。

### OrderWise 多平台 MCP 源

公开项目 [OrderWise-Agent](https://github.com/ucloud/orderwise-agent) 提供 `compare_prices` MCP 工具，面向美团、京东外卖、淘宝闪购等平台并行比价。它适合接云手机或 Sandbox 部署：外部服务负责手机视觉自动化和结构化价格提取，本项目只负责把结果转成统一咖啡榜单。

本项目提供 `orderwise:mcp-source`，默认连接 `http://127.0.0.1:8703/mcp`：

```powershell
npm run orderwise:mcp-source -- --endpoint "http://127.0.0.1:8703/mcp" --brands "瑞幸,库迪,星巴克" --apps "美团,京东外卖,淘宝闪购"
```

作为 `externalSources` 运行时，它会从 stdin 读取 `{ query, address }`，对每个品牌调用一次 OrderWise `compare_prices(product_name=饮品, seller_name=品牌, apps=...)`，并把 `platforms[]` 或 `platform_results{}` 中的 `price`、`delivery_fee`、`pack_fee`、`total_fee` 映射成外卖到手价候选。示例配置已包含一个禁用的 `orderwiseMcp` 外部源。

启动本机 OrderWise MCP 服务：

```powershell
npm run orderwise:serve
```

这个脚本使用兼容 FastMCP 3 的模块入口 `mcp_mode.mcp_server.order_wise_mcp_server`，并把 winget 常见 ADB 目录临时加入子进程 `PATH`。如果 OrderWise 源码或 Python 虚拟环境不在默认位置，可以传 `--repo`、`--python`、`--adb`。

现场检查：

```powershell
npm run orderwise:doctor
```

它会检查 MCP endpoint 是否能列出 `compare_prices` 工具、`app_device_mapping.json` 是否仍是占位值，以及 `PHONE_AGENT_BASE_URL` / `PHONE_AGENT_MODEL` 是否已配置。

可选环境变量：

```powershell
$env:ORDERWISE_MCP_URL = "http://127.0.0.1:8703/mcp"
$env:ORDERWISE_BRANDS = "瑞幸,库迪,星巴克"
$env:ORDERWISE_APPS = "美团,京东外卖,淘宝闪购"
$env:ORDERWISE_MODEL_PROVIDER = "local"
$env:ORDERWISE_DEVICE_MAPPING = '{"app1":"device-a","app2":"device-b","app3":"device-c"}'
```

边界：OrderWise 比本机 `meituan-cli` 更接近“服务型/云手机”路线，但它仍需要已连接并登录的云手机/Android 设备，以及可用的 AutoGLM/Phone Agent 模型服务。遇到登录、验证码或接管请求时，源会返回明确原因和 `session_id`，不会编造价格，也不会提交订单。

### 瑞幸官方 MCP 源

瑞幸咖啡 AI 开放平台提供官方 MCP Server。它适合作为第一条真实授权价格源：不抓美团/饿了么 H5，不处理验证码，只走用户 token 授权的官方工具。当前桥接只调用门店查询、商品搜索和订单预览，用于拿自取预估到手价；不会调用 `createOrder`，因此不会自动下单。

先从瑞幸开放平台生成 token，并只保存在本机环境变量或本机文件。推荐直接把开放平台复制出来的 token、Bearer 头、JSON 配置或授权命令粘给导入命令。当前环境是 Windows PowerShell 5.1，经 `npm run` 转发时用 `--token` 参数比管道 stdin 更稳定：

```powershell
npm run --silent luckin:setup -- --token "Authorization: Bearer <你的瑞幸 MCP token>"
```

`luckin:setup` 会把 token 写入 `%USERPROFILE%\.my-coffee\LUCKIN_MCP_TOKEN`，启用本地 `luckinMcp` 外部源，运行专项检查，并在实时源 ready 时调用 `pricebook:refresh` 写入本地价格库。输出不会打印 token 内容。

没有 token 时也可以运行：

```powershell
npm run luckin:setup
```

这条命令会报告 `DEGRADED` 而不是硬失败：微信查价仍可使用本地价格库和城市参考价，但瑞幸官方 MCP 实时自取价会保持未启用。若你要把实时 MCP 当作强制验收条件，加 `--require-live`，检查不通过时命令会返回非零退出码。

底层导入命令仍可用于排障或只想保存 token 的场景：

```powershell
npm run --silent luckin:import-token -- --token "Authorization: Bearer <你的瑞幸 MCP token>" --enable
```

如果只想临时放在当前 Windows PowerShell 会话里，也可以用环境变量：

```powershell
$env:LUCKIN_MCP_TOKEN = "你的瑞幸 MCP token"
```

不要把 token 写进 Git 仓库。

启用前可以先跑专项检查：

```powershell
npm run luckin:doctor
```

它会检查配置文件、token、地址经纬度、`externalSources.luckinMcp` 是否存在/启用，以及 MCP endpoint 是否是有效 HTTPS 地址。`FAIL` 代表还不能走瑞幸官方实时价；`WARN` 通常表示 token 和坐标已具备，但 `luckinMcp.enabled` 仍是 `false`。

然后启用示例里的 `luckinMcp` 外部源：

```powershell
npm run luckin:enable
```

这条命令只把本地配置里的 `luckinMcp.enabled` 改为 `true`，不会保存 token。等价的手工配置如下：

```json
{
  "id": "luckinMcp",
  "label": "瑞幸官方 MCP",
  "enabled": true,
  "command": "node",
  "args": ["--import", "tsx", "src/luckin-mcp-source-cli.ts"],
  "timeoutMs": 45000
}
```

可用下面的命令单独验证桥接源。命令会从 stdin 读取 OpenClaw 外部源请求，输出统一 `PlatformSnapshot` JSON：

```powershell
npm run luckin:mcp-source
```

缺少 token 时会返回 `login_required`，缺少经纬度时会返回 `unavailable`，不会猜价格。

接入 MCP/授权接口后，推荐用刷新命令把外部源结果写入本地价格库：

```powershell
npm run pricebook:refresh
```

默认会读取 `priceBookRefresh.queries`，逐条调用已启用的 `externalSources`，再原子写入 `priceBookRefresh.outputPath` 或 `priceBookPath`。如果只想临时刷新一个查询：

```powershell
npm run pricebook:refresh -- --query "查公司附近冰美式"
```

刷新命令只调用已启用的外部源（命令行、MCP 桥接或 HTTP 服务），不会打开美团/饿了么 H5，也不会处理或绕过验证码。外部源没有返回可比价格时，命令会失败并保留现有 `pricebook.json` 不变；成功时会替换同地址、同饮品、同规格的旧条目，并保留其它饮品/地址的旧条目。

## 浏览器提取器

`browserSources` 是可选增强源，可以为每个网页渠道配置一个入口 URL 和 CSS 选择器。工具会使用 `browserProfilePath` 指向的独立浏览器 profile 打开页面，然后提取字段：

- `loginRequired` / `captchaRequired` / `noStock`：先识别不可报价状态
- `offerRows`：每个可比价格行
- `fields`：品牌、门店、饮品、履约方式、价格、配送费、包装费、距离、购买链接等
- `discounts`：优惠行、优惠名称和金额

入口 URL 支持模板变量：`{{addressQuery}}`、`{{addressAlias}}`、`{{drink}}`、`{{normalizedDrink}}`、`{{quantity}}`、`{{size}}`、`{{temperature}}`。

有些 H5 页面只靠 URL 参数不会真正触发搜索，可以在 `browser.search` 里配置页面动作。工具会打开入口页后填入 `drink`，如果配置了 `submitSelector` 就点击提交；否则会在输入框按 Enter；`waitAfterMs` 用于等待结果页或接口完成刷新。这个动作同时用于 `npm run capture` 和微信触发的实际浏览器查价。

```json
"browser": {
  "search": {
    "inputSelector": "input[type=\"search\"]",
    "submitSelector": "button[type=\"submit\"]",
    "waitAfterMs": 3000
  }
}
```

真实平台页面需要登录后用浏览器检查 DOM，再把选择器填入 `config/coffee-price.config.json`。如果页面出现验证码、登录失效、无货或平台临时不可用，可以在 `selectors.statusTextPatterns` 里配置页面文本片段；工具会返回明确原因，不会继续猜价。

## 页面捕获与 selector 校准

真实平台接入时，先用独立 profile 捕获页面，生成可回放的 HTML 和 snapshot：

```powershell
npm run capture -- "查公司附近冰美式" --source meituan --manual-ms 120000
```

这条命令会用 `browserProfilePath` 打开配置里的 `browserSources.meituan.entryUrl`，等待 120 秒给你手动登录、处理验证码或切换到正确页面，然后保存：

- `.runtime/captures/meituan.html`
- `.runtime/captures/meituan.snapshot.json`
- `.runtime/captures/meituan.audit.json`
- `.runtime/captures/meituan.network.json`

如果要指定输出位置：

```powershell
npm run capture -- "查公司附近冰美式" --source meituan --html .runtime/captures/meituan.html --snapshot config/snapshots/meituan.live.json --audit .runtime/captures/meituan.audit.json --network .runtime/captures/meituan.network.json
```

如果现场已经在浏览器里打开了真实平台页面，可以先不改配置，临时覆盖入口 URL：

```powershell
npm run capture -- "查公司附近冰美式" --source meituan --url "https://example.com/replace-with-real-platform-page" --manual-ms 120000
```

确认这个入口 URL 可用后，可以在同一次捕获成功后写回配置，避免后续 `verify:live` 继续报 `example.com` 占位：

```powershell
npm run capture -- "查公司附近冰美式" --source meituan --url "https://example.com/replace-with-real-platform-page" --save-url --manual-ms 120000
```

如果要一次校准所有启用渠道，可以用批量命令。仍是逐个打开独立 profile 页面，但会自动保存每个渠道的 HTML、snapshot、selector audit，并把显式传入的真实 URL 写回配置：

```powershell
npm run capture:calibrate -- "查公司附近冰美式" --url-meituan "https://example.com/replace-with-real-meituan-page" --url-eleme "https://example.com/replace-with-real-eleme-page" --url-brand "https://example.com/replace-with-real-brand-page" --manual-ms 120000
```

批量校准时，某个渠道失败不会阻止后续渠道继续捕获；但只要有任一渠道失败，命令最终会返回非零退出码，并在输出里标出 `[source] FAILED: ...`。每次运行还会写出 `.runtime/captures/calibration-report.json`，里面记录每个渠道的成功/失败、HTML、snapshot、audit 路径和错误原因；需要改路径时加 `--report <path>`。

捕获工具只保存页面内容、解析结果、selector 诊断和精简网络摘要，不会保存密码、cookie、响应正文或 URL 查询参数，也不会绕过验证码。即使 `waitForSelector` 等不到候选行，工具也会继续保存 HTML、`*.audit.json` 和 `*.network.json`，方便判断当前是登录页、验证码页、无货页、平台临时不可用还是页面结构变了。页面结构变化时，优先用新捕获的 HTML 调整 `browserSources.<source>.selectors`。`*.audit.json` 用来定位选择器问题：先看 `statusMatches` 是否命中登录/验证码/无货，再看 `offerRows.count` 是否为 0，最后看每一行的 `missingRequiredFields`。`*.network.json` 用来看 document/fetch/xhr 的状态码和 request failed 原因，不用于价格提取；其中 URL 只保留 origin/path，查询参数会写成 `<redacted>`。

## 购买页自动打开

`openLowestPurchasePage` 控制是否在查价后打开最低价候选的购买页。示例配置默认开启：

```json
{
  "openLowestPurchasePage": true
}
```

工具只会打开价格榜单中最低的安全 `http/https` 链接；如果最低价候选没有购买链接，或链接是 `javascript:`、`file:` 等非网页 scheme，会跳过并尝试下一个可打开候选。打开页面只负责跳转到购买页，不会自动提交订单。

## 开发命令

```powershell
npm test
npm run typecheck
npm run build
npm run config:scaffold -- --config config/coffee-price.config.json --write
npm run config:set-url -- --source meituan --url "https://example.com/replace-with-real-platform-page" --write
npm run doctor
npm run luckin:setup
npm run capture -- "查公司附近冰美式" --source meituan --manual-ms 120000
npm run capture:calibrate -- "查公司附近冰美式" --url-meituan "https://example.com/replace-with-real-meituan-page" --url-eleme "https://example.com/replace-with-real-eleme-page" --url-brand "https://example.com/replace-with-real-brand-page" --manual-ms 120000
npm run verify:live
```

`verify:live` 是现场验收前置检查：它会运行 doctor，检查启用渠道是否配置了真实 `browserSources`，并读取 `.runtime/captures/<source>.audit.json` 确认 selector 已经命中候选行且没有缺失必填价格字段。它还会读取 `.runtime/captures/calibration-report.json` 作为上次批量校准的补充证据；需要指定其它路径时用 `--calibration-report <path>`。它失败时不会猜测价格，只会列出下一步要补的扫码、配置或 selector 校准动作；如果入口 URL 还是占位，它会直接给出 `npm run capture -- ... --url "<real-platform-url>" --save-url --manual-ms 120000` 这类可执行命令。多个渠道同时是占位 URL 时，“下一步动作”会给出一条 `npm run capture:calibrate -- ...` 批量校准命令。

如果确认 `.runtime/captures/calibration-report.json` 已经过期，只想检查当前 doctor、入口 URL 和 selector audit 状态，可以运行 `npm run verify:live -- --ignore-calibration-report`。这个开关只跳过上次批量校准报告，不会跳过扫码登录、真实 URL 或 selector 覆盖检查。

`verify:live` 还会在报告末尾输出阶段化“下一步动作”。如果某个渠道还在使用 `example.com` 占位入口，它会先要求写入真实 URL 或运行批量校准，不会把该渠道的 selector audit 放进当前动作队列，避免对占位页面做无效捕获。

需要给脚本或自动化消费验收结果时，可以运行 `npm run --silent verify:live -- --json`。JSON 输出包含 `status`、逐项 `checks` 和阶段化 `actions`，退出码仍保持一致：`FAIL` 返回非零，`PASS/WARN` 返回 0。加 `--silent` 是为了避免 npm 在 JSON 前打印脚本头。

只想拿下一条可执行命令时，可以运行 `npm run --silent verify:next -- --ignore-calibration-report --command-only`。它会复用 `verify:live` 的检查结果，只输出第一条 action 的命令，例如当前现场状态会输出带 `--open-qr --qr-url-file .runtime/weixin-login/qr-url.txt --qr-html-file .runtime/weixin-login/qr.html` 的微信登录命令；需要查看全部动作时加 `--all`，需要机器读取时加 `--json`。

## 价格边界

- 外卖价：商品价 x 数量 + 配送费 + 包装费 - 可用优惠
- 自取价：商品价 x 数量 - 可用优惠
- 不同品类不混比，例如冰美式不会和拿铁一起排名
- 品牌池默认只包含主流连锁咖啡
- 没有可比结果时返回原因，不返回猜测价格
