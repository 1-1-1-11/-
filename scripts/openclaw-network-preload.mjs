import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";

const DEFAULT_ILINK_IPS = ["43.163.179.90", "43.163.165.187"];
const PINNED_HOSTS = new Map([
  ["ilinkai.weixin.qq.com", readPinnedIps("OPENCLAW_WEIXIN_ILINK_IPS", DEFAULT_ILINK_IPS)],
  ["aewebpodproxy.weixin.qq.com", readPinnedIps("OPENCLAW_WEIXIN_ILINK_IPS", DEFAULT_ILINK_IPS)]
]);

dns.setDefaultResultOrder?.("ipv4first");

setGlobalDispatcher(
  new Agent({
    connect: {
      lookup(hostname, options, callback) {
        const pinned = PINNED_HOSTS.get(hostname.toLowerCase());
        if (pinned?.length) {
          if (options?.all) {
            callback(null, pinned.map((address) => ({ address, family: 4 })));
          } else {
            callback(null, pinned[0], 4);
          }
          return;
        }
        dns.lookup(hostname, options, callback);
      }
    }
  })
);

function readPinnedIps(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}
