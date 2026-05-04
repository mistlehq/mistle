import { describe, expect, it } from "vitest";

import { runPooledEnvironmentStressScenario } from "./environment-pooling-stress-scenario.js";

describe("pooled environment stress worker 5", () => {
  it("shares the pooled service under worker-level parallelism", async () => {
    expect.hasAssertions();
    await runPooledEnvironmentStressScenario({ label: "worker-5" });
  });
});
