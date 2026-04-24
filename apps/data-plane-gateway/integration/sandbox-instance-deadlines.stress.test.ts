/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { typeid } from "typeid-js";
import { describe } from "vitest";

import { exerciseOverlappingBootstrapReplacement } from "./sandbox-instance-deadlines-overlap-test-helpers.js";
import {
  findDataPlaneGatewayStressCaseByName,
  resolveDataPlaneGatewayStressIterationCount,
} from "./stress-config.js";
import { it } from "./test-context.js";

const SandboxInstanceDeadlinesStressCase = findDataPlaneGatewayStressCaseByName(
  "sandbox-instance-deadlines",
);

if (SandboxInstanceDeadlinesStressCase === undefined) {
  throw new Error("Expected the sandbox-instance-deadlines stress case to be configured.");
}

const GatewayDeadlineStressIterations = resolveDataPlaneGatewayStressIterationCount({
  environment: process.env,
  stressCase: SandboxInstanceDeadlinesStressCase,
});

describe("sandbox instance deadlines stress", () => {
  it("survives repeated overlapping bootstrap replacement churn", async ({ fixture }) => {
    for (let iteration = 0; iteration < GatewayDeadlineStressIterations; iteration += 1) {
      await exerciseOverlappingBootstrapReplacement({
        fixture,
        sandboxInstanceId: typeid("sbi").toString(),
        testId: `gateway_deadline_stress_${String(iteration)}`,
      });
    }
  }, 300_000);
});
