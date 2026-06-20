const input = JSON.parse(await readStdin());
const drink = input.query?.normalizedDrink ?? "americano";
const addressAlias = input.address?.alias ?? "默认";

const snapshot = {
  source: "external-example",
  offers: [
    {
      brand: "瑞幸",
      storeName: `外部源示例 ${addressAlias}`,
      drinkName: drink === "latte" ? "拿铁" : "冰美式",
      normalizedDrink: drink,
      size: drink === "latte" ? "大杯" : "中杯",
      fulfillment: "pickup",
      itemPrice: drink === "latte" ? 18.9 : 12.9,
      quantity: 1,
      discounts: [{ label: "外部源示例券", amount: drink === "latte" ? 7 : 4 }],
      distanceText: "外部源返回",
      purchaseUrl: "https://lkcoffee.com/"
    }
  ]
};

console.log(JSON.stringify(snapshot));

async function readStdin() {
  if (process.stdin.isTTY) {
    return "{}";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim() || "{}";
}
