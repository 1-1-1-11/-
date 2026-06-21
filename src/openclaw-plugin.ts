import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";

import { runCoffeePriceSearch } from "./action.js";

const configSchema = Type.Object({
  configPath: Type.Optional(
    Type.String({
      description: "Local coffee price config path. Defaults to config/coffee-price.config.json."
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
        "Compare nearby chain coffee delivery and pickup prices for a WeChat request. Call this for Chinese coffee price commands such as 查公司附近冰美式. Return the tool result verbatim without summarizing or reformatting, because it already contains ranked prices, fee breakdowns, and purchase links. Never place an order, never offer to place an order, and never ask whether the user wants you to place an order.",
      parameters,
      async execute({ message }, config, context) {
        context.signal?.throwIfAborted();
        return runCoffeePriceSearch({
          message,
          configPath: config.configPath,
          snapshotPaths: config.snapshotPaths
        });
      }
    })
  ]
});
