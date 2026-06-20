# OpenClaw 微信咖啡比价助手

本项目是一个本机 Windows 常驻的咖啡查价工具骨架：微信私聊进入 OpenClaw，OpenClaw 调用 `coffee_price.search`，工具按常用地址返回附近主流连锁咖啡的外卖到手价和自取价榜单。

第一版不自动下单，不扫非品牌小店，不保存平台密码。平台验证码、登录失效、门店无货时会明确返回原因，不编造价格。

## 当前实现

- `coffee_price.search` OpenClaw tool plugin
- 微信消息文本解析：如 `查公司附近冰美式`、`查咖啡 冰美式 两杯`
- 本地配置读取：地址、品牌池、渠道开关、独立浏览器 profile 路径
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

编辑 `config/coffee-price.config.json`，把 `addresses` 改成你的常用地址。

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

示例快照不会访问真实平台，只用于验证查价链路：

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

## 浏览器提取器

`browserSources` 可以为每个渠道配置一个入口 URL 和 CSS 选择器。工具会使用 `browserProfilePath` 指向的独立浏览器 profile 打开页面，然后提取字段：

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
