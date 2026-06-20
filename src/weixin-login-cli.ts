import { completeWeixinLogin } from "./weixin-login.js";

const timeoutMs = readNumberOption("--timeout-ms") ?? 480_000;
const pollIntervalMs = readNumberOption("--poll-ms") ?? 1000;

try {
  const result = await completeWeixinLogin({
    timeoutMs,
    pollIntervalMs,
    onQrCode: (url) => {
      console.log("微信扫码链接:");
      console.log(url);
      console.log("请用手机微信扫描该链接生成的二维码，或把链接复制到浏览器后扫码。");
    },
    onStatus: (status) => {
      if (status !== "wait") {
        console.log(`微信登录状态: ${status}`);
      }
    }
  });

  if (result.status === "connected") {
    console.log(`微信已连接: ${result.accountId}`);
    console.log("已更新 OpenClaw 微信 channel 配置刷新时间戳；如果 Gateway 仍未识别，请运行 npx openclaw gateway restart。");
    process.exit(0);
  } else if (result.status === "already_connected") {
    console.log(result.message);
    process.exit(0);
  } else {
    console.error(result.message);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function readNumberOption(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数毫秒`);
  }
  return parsed;
}
