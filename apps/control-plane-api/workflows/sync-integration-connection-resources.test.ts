import { expect, test } from "vitest";

import { SyncIntegrationConnectionResourcesWorkflow } from "./sync-integration-connection-resources.js";

test("SyncIntegrationConnectionResourcesWorkflow preserves the existing workflow identity", () => {
  expect(SyncIntegrationConnectionResourcesWorkflow.spec.name).toBe(
    "control-plane.integration-connections.sync-resources",
  );
  expect(SyncIntegrationConnectionResourcesWorkflow.spec.version).toBe("1");
});
