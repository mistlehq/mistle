import { describe, expect, it } from "vitest";

import { systemSleeper } from "./sleeper.js";

describe("@mistle/time sleeper", () => {
  it("sleeps for at least the requested duration", async () => {
    const startedAt = Date.now();
    await systemSleeper.sleep(10);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(8);
  });
});
