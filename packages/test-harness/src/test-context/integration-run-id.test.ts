import { describe, expect, it } from "vitest";

import {
  IntegrationRunIdEnvVar,
  createIntegrationRuntimeDatabaseName,
  createIntegrationRuntimeScopeId,
  createIntegrationTemplateDatabaseName,
  resolveIntegrationRunId,
} from "./integration-run-id.js";

describe("integration run id helpers", () => {
  it("normalizes the integration run id from the environment", () => {
    expect(
      resolveIntegrationRunId({
        [IntegrationRunIdEnvVar]: "Run-Id_123",
      }),
    ).toBe("runid123");
  });

  it("creates stable PostgreSQL-safe template and runtime database names", () => {
    const templateDatabaseName = createIntegrationTemplateDatabaseName({
      prefix: "mistle_control_plane_api_it_template",
      runId: "abc123def456",
    });

    const runtimeDatabaseName = createIntegrationRuntimeDatabaseName({
      prefix: "mistle_control_plane_api_it_runtime",
      runId: "abc123def456",
      filePath: "/tmp/example.integration.test.ts",
      scopeId: "scope1234",
    });

    expect(templateDatabaseName).toBe("mistle_control_plane_api_it_template_abc123def456");
    expect(runtimeDatabaseName).toMatch(
      /^mistle_control_plane_api_it_runtime_abc123def456_[a-f0-9]{4,12}_scope123$/u,
    );
    expect(runtimeDatabaseName.length).toBeLessThanOrEqual(63);
  });

  it("creates unique runtime scope ids", () => {
    expect(createIntegrationRuntimeScopeId()).toMatch(/^[a-f0-9]{8}$/u);
    expect(createIntegrationRuntimeScopeId()).not.toBe(createIntegrationRuntimeScopeId());
  });

  it("compacts long runtime prefixes while preserving a PostgreSQL-safe name", () => {
    const runtimeDatabaseName = createIntegrationRuntimeDatabaseName({
      prefix: "mistle_control_plane_worker_it_runtime",
      runId: "abc123def456",
      filePath: "/tmp/example.integration.test.ts",
      scopeId: "scope1234",
    });

    expect(runtimeDatabaseName).toMatch(
      /^mistle_control_plane_worker_[a-f0-9]{8}_abc123def456_[a-f0-9]{4}_scope123$/u,
    );
    expect(runtimeDatabaseName.length).toBeLessThanOrEqual(63);
  });
});
