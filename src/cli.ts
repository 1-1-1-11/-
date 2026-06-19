import { runCoffeePriceSearch } from "./action.js";
import type { SourceConfig } from "./types.js";

const args = process.argv.slice(2);
const message = args.find((arg) => !arg.startsWith("--"));
const configPath = readOption("--config");
const snapshotPaths = readSnapshotPaths();

if (!message) {
  console.error("Usage: npm run coffee -- \"查公司附近冰美式\" --config config/coffee-price.config.json");
  process.exitCode = 1;
} else {
  const reply = await runCoffeePriceSearch({ message, configPath, snapshotPaths });
  console.log(reply);
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readSnapshotPaths(): Partial<Record<keyof SourceConfig, string>> {
  const paths: Partial<Record<keyof SourceConfig, string>> = {};
  const meituan = readOption("--snapshot-meituan");
  const eleme = readOption("--snapshot-eleme");
  const brandOfficial = readOption("--snapshot-brand");
  if (meituan) paths.meituan = meituan;
  if (eleme) paths.eleme = eleme;
  if (brandOfficial) paths.brandOfficial = brandOfficial;
  return paths;
}
