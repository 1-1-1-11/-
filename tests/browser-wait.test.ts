import assert from "node:assert/strict";
import test from "node:test";

import { waitForOptionalSelector } from "../src/browser-wait.js";

test("waitForOptionalSelector ignores Playwright selector timeout errors", async () => {
  let calls = 0;

  await waitForOptionalSelector(
    {
      waitForSelector: async () => {
        calls += 1;
        const error = new Error("Timeout 50ms exceeded while waiting for selector");
        error.name = "TimeoutError";
        throw error;
      }
    },
    "[data-offer]",
    50
  );

  assert.equal(calls, 1);
});

test("waitForOptionalSelector rethrows non-timeout selector errors", async () => {
  await assert.rejects(
    () =>
      waitForOptionalSelector(
        {
          waitForSelector: async () => {
            throw new Error("browser disconnected");
          }
        },
        "[data-offer]",
        50
      ),
    /browser disconnected/
  );
});

test("waitForOptionalSelector returns immediately when selector is missing", async () => {
  let calls = 0;

  await waitForOptionalSelector(
    {
      waitForSelector: async () => {
        calls += 1;
      }
    },
    undefined,
    50
  );

  assert.equal(calls, 0);
});
