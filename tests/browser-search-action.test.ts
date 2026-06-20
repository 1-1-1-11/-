import assert from "node:assert/strict";
import test from "node:test";

import { applyBrowserSearchAction } from "../src/browser-search-action.js";

test("fills search input and clicks a configured submit control", async () => {
  const events: string[] = [];
  const page = createFakeSearchPage(events);

  await applyBrowserSearchAction(page, {
    search: {
      inputSelector: "input[type=search]",
      submitSelector: "button[type=submit]",
      waitAfterMs: 750
    },
    searchText: "冰美式"
  });

  assert.deepEqual(events, [
    "locator:input[type=search]",
    "first",
    "fill:冰美式",
    "locator:button[type=submit]",
    "first",
    "click",
    "wait:750"
  ]);
});

test("presses Enter when no submit control is configured", async () => {
  const events: string[] = [];
  const page = createFakeSearchPage(events);

  await applyBrowserSearchAction(page, {
    search: {
      inputSelector: "input[placeholder=\"请输入商家或商品名称\"]"
    },
    searchText: "拿铁"
  });

  assert.deepEqual(events, [
    "locator:input[placeholder=\"请输入商家或商品名称\"]",
    "first",
    "fill:拿铁",
    "press:Enter",
    "wait:3000"
  ]);
});

function createFakeSearchPage(events: string[]) {
  return {
    locator(selector: string) {
      events.push(`locator:${selector}`);
      return {
        first() {
          events.push("first");
          return this;
        },
        async fill(value: string) {
          events.push(`fill:${value}`);
        },
        async click() {
          events.push("click");
        },
        async press(key: string) {
          events.push(`press:${key}`);
        }
      };
    },
    async waitForTimeout(ms: number) {
      events.push(`wait:${ms}`);
    }
  };
}
