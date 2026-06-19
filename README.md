# OpenClaw 微信咖啡比价助手

本项目是一个本机 Windows 常驻的咖啡查价工具骨架：微信私聊进入 OpenClaw，OpenClaw 调用 `coffee_price.search`，工具按常用地址返回附近主流连锁咖啡的外卖到手价和自取价榜单。

第一版不自动下单，不扫非品牌小店，不保存平台密码。平台验证码、登录失效、门店无货时会明确返回原因，不编造价格。

## 当前实现

- `coffee_price.search` OpenClaw tool plugin
- 微信消息文本解析：如 `查公司附近冰美式`、`查咖啡 冰美式 两杯`
- 本地配置读取：地址、品牌池、渠道开关、独立浏览器 profile 路径
- 统一渠道快照适配器：美团/饿了么/品牌官方页面提取结果先归一成 snapshot，再排序
- 外卖和自取分别 Top 3，价格包含商品、配送、包装和优惠拆解
- 本地 CLI：`npm run coffee -- "查公司附近冰美式" --config config/coffee-price.config.json`

## 初始化

```powershell
npm install
Copy-Item config/coffee-price.config.example.json config/coffee-price.config.json
```

编辑 `config/coffee-price.config.json`，把 `addresses` 改成你的常用地址。

注意：这里说的 `powershell` 是 Windows PowerShell 5.1。如果你用 PowerShell 7，命令入口通常是 `pwsh`，脚本本身两者都可以运行。

## 本地验证

示例快照不会访问真实平台，只用于验证查价链路：

```powershell
Copy-Item config/snapshots/meituan.example.json config/snapshots/meituan.json
npm run coffee -- "查公司附近冰美式" --config config/coffee-price.config.json --snapshot-meituan config/snapshots/meituan.json
```

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

脚本会安装 OpenClaw CLI、安装 `@tencent-weixin/openclaw-weixin`、启用 `openclaw-weixin` channel，并在 `-Login` 时启动微信 QR 登录。
因为当前项目路径包含中文，脚本会创建 `C:\Users\32299\.openclaw\coffee-price-project` 这个 ASCII junction，并修复 OpenClaw Gateway 的 Scheduled Task wrapper，避免 Windows `.cmd` 把中文路径写成乱码。

OpenClaw 官方文档当前说明微信 channel 是外部插件，支持私聊和媒体，群聊能力未在插件能力元数据中声明。因此本项目第一版按微信私聊设计。

## OpenClaw 插件配置

把本项目作为本地插件安装后，为插件配置本地路径：

```powershell
openclaw plugins install .
openclaw config set plugins.entries.coffee-price.enabled true
openclaw config set plugins.entries.coffee-price.config.configPath "D:\Desktop\自动查价\config\coffee-price.config.json"
openclaw config set plugins.entries.coffee-price.config.snapshotPaths.meituan "D:\Desktop\自动查价\config\snapshots\meituan.json"
openclaw gateway restart
```

真实自动查价时，后续要把美团、饿了么、品牌官方页面自动化提取层接到同一个 snapshot 格式。现在的 snapshot 适配器已经把“登录失效/验证码/无货/可比候选”边界固定住。

## 开发命令

```powershell
npm test
npm run typecheck
npm run build
```

## 价格边界

- 外卖价：商品价 x 数量 + 配送费 + 包装费 - 可用优惠
- 自取价：商品价 x 数量 - 可用优惠
- 不同品类不混比，例如冰美式不会和拿铁一起排名
- 品牌池默认只包含主流连锁咖啡
- 没有可比结果时返回原因，不返回猜测价格
