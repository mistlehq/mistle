import { describe, expect, it } from "vitest";

import { loadDataPlaneApiFromEnv } from "./load-env.js";

describe("data-plane api workflow config", () => {
  it("loads workflow migration config from env when configured", () => {
    const loaded = loadDataPlaneApiFromEnv({
      MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL:
        "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
      MISTLE_APPS_DATA_PLANE_API_WORKFLOW_MIGRATION_URL:
        "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID: "development",
    });

    expect(loaded.workflow).toEqual({
      databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
      migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      namespaceId: "development",
    });
  });
});
