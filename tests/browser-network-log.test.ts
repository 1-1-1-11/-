import assert from "node:assert/strict";
import test from "node:test";

import { redactNetworkLogUrl } from "../src/browser-network-log.js";

test("redacts network log URL query parameters", () => {
  assert.equal(
    redactNetworkLogUrl(
      "https://i.waimai.meituan.com/openh5/search/globalpage?_=1781953824799&dfpId=abc&token=secret"
    ),
    "https://i.waimai.meituan.com/openh5/search/globalpage?<redacted>"
  );
});

test("preserves URL origin and path when no query is present", () => {
  assert.equal(
    redactNetworkLogUrl("https://h5.waimai.meituan.com/waimai/mindex/searchresults"),
    "https://h5.waimai.meituan.com/waimai/mindex/searchresults"
  );
});
