import { describe, expect, it } from "vitest";

import { immediateSleeper } from "./immediate-sleeper.js";

describe("@mistle/time testing immediate-sleeper", () => {
  it("resolves without waiting on real timers", async () => {
    await expect(immediateSleeper.sleep(10_000)).resolves.toBeUndefined();
  });
});
