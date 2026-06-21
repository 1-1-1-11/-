import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

import { runCoffeePriceSearch } from "./action.js";
import { bindLuckinTokenFromMessage } from "./luckin-token-bind.js";

const configSchema = Type.Object({
  configPath: Type.Optional(
    Type.String({
      description: "Local coffee price config path. Defaults to config/coffee-price.config.json."
    })
  ),
  luckinTokenPath: Type.Optional(
    Type.String({
      description: "Local path for the user's Luckin MCP token. Defaults to the user profile token file."
    })
  ),
  snapshotPaths: Type.Optional(
    Type.Object({
      meituan: Type.Optional(Type.String({ description: "Optional Meituan snapshot JSON path." })),
      eleme: Type.Optional(Type.String({ description: "Optional Eleme snapshot JSON path." })),
      brandOfficial: Type.Optional(Type.String({ description: "Optional brand official snapshot JSON path." }))
    })
  )
});

const parameters = Type.Object({
  message: Type.String({
    description: "The WeChat coffee price request, for example 查公司附近冰美式 or 查咖啡 拿铁 两杯."
  })
});

const tokenBindParameters = Type.Object({
  message: Type.String({
    description: "The private WeChat message containing a Luckin MCP token, for example 绑定瑞幸 token Authorization: Bearer <token>."
  })
});

export default defineToolPlugin({
  id: "coffee-price",
  name: "Coffee Price Search",
  description: "Search nearby chain coffee delivery and pickup prices, then return a WeChat-ready ranking.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "coffee_price_search",
      label: "Coffee Price Search",
      description:
        "Compare nearby chain coffee delivery and pickup prices for a WeChat request. Call this for Chinese coffee price commands such as 查公司附近冰美式. Return the tool result verbatim without summarizing or reformatting, because it already contains ranked prices, fee breakdowns, and purchase links. You must keep any sections starting with 需要处理 or 未打开购买页 exactly as returned; they are safety-critical status boundaries. Never place an order, never offer to place an order, and never ask whether the user wants you to place an order.",
      parameters,
      async execute({ message }, config, context) {
        context.signal?.throwIfAborted();
        return runCoffeePriceSearch({
          message,
          configPath: config.configPath,
          snapshotPaths: config.snapshotPaths
        });
      }
    }),
    tool({
      name: "luckin_token_bind",
      label: "Bind Luckin Token",
      description:
        "Bind/import a Luckin MCP token from a private WeChat message such as 绑定瑞幸 token Authorization: Bearer <token>. Call this tool for any Luckin token binding/import/update/configuration message, even if the message appears to omit the token, because the tool returns safe guidance. Only accept official Luckin MCP/Open Platform tokens; do not suggest packet capture, reverse engineering, scraping, browser developer tools, or app traffic inspection. Never reveal, repeat, summarize, or log the token in the visible reply. Never place an order, never offer to place an order, and never ask whether the user wants you to place an order.",
      parameters: tokenBindParameters,
      async execute({ message }, config, context) {
        context.signal?.throwIfAborted();
        const result = await bindLuckinTokenFromMessage({
          message,
          tokenPath: config.luckinTokenPath,
          configPath: config.configPath
        });
        return result.text;
      }
    })
  ]
});
