import { describe, expect, it } from "vitest";

import { parseGetSandboxInstanceResponse } from "./index.js";

describe("parseGetSandboxInstanceResponse", () => {
  it("accepts degraded sandbox instance status responses", () => {
    const parsed = parseGetSandboxInstanceResponse({
      id: "sbi_01kt8rd8wnexxtv7k0w42bag97",
      sandboxProfileId: "sbp_01ks239nw9e4ab30nth13rq4ry",
      sandboxProfileVersion: 19,
      title: "Production connection loss check",
      status: "degraded",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
      startupOperation: {
        operationId: "7517dd71-0f1d-4de2-b359-7c9200806894",
        operationKind: "resume",
      },
    });

    expect(parsed?.status).toBe("degraded");
  });
});
