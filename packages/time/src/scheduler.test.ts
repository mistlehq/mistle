import { describe, expect, it } from "vitest";

import { systemScheduler } from "./scheduler.js";
import { systemSleeper } from "./sleeper.js";

describe("@mistle/time scheduler", () => {
  it("can schedule and cancel callbacks", async () => {
    let called = false;
    const handle = systemScheduler.schedule(() => {
      called = true;
    }, 50);

    systemScheduler.cancel(handle);
    await systemSleeper.sleep(80);

    expect(called).toBe(false);
  });
});
