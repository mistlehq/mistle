import { randomUUID } from "node:crypto";

import { SandboxImageKind } from "@mistle/sandbox";
import { describe, expect } from "vitest";

import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowInput,
} from "../../src/data-plane/index.js";
import { dockerStartSandboxWorkflowIntegrationEnabled, it } from "./test-context.js";

const describeDockerWorkflowIntegration = dockerStartSandboxWorkflowIntegrationEnabled
  ? describe
  : describe.skip;

const FORBIDDEN_ORGANIZATION_ID = "org-workflow-forbidden";
const FORBIDDEN_ORGANIZATION_CONSTRAINT = "sandbox_instances_forbidden_organization_check";
const StartedBootstrapTokenJtiWaitTimeoutMs = 10_000;
const StartedBootstrapTokenJtiPollIntervalMs = 100;

function createDockerBaseImageHandle(imageId: string): StartSandboxInstanceWorkflowInput["image"] {
  return {
    imageId,
    kind: SandboxImageKind.BASE,
    createdAt: new Date().toISOString(),
  };
}

describeDockerWorkflowIntegration("start sandbox instance workflow integration", () => {
  it("starts a docker sandbox and persists sandbox instance state", async ({ fixture }) => {
    const startedBootstrapTokenJtiCountBefore = fixture.startedBootstrapTokenJtis.length;

    const handle = await fixture.openWorkflow.runWorkflow(StartSandboxInstanceWorkflowSpec, {
      organizationId: `org-${randomUUID()}`,
      sandboxProfileId: `sbp-${randomUUID()}`,
      sandboxProfileVersion: 1,
      startedBy: {
        kind: "user",
        id: `usr-${randomUUID()}`,
      },
      source: "dashboard",
      image: createDockerBaseImageHandle("registry:3"),
    });

    const resultPromise = handle.result({ timeoutMs: 45_000 });
    const waitDeadlineMs = Date.now() + StartedBootstrapTokenJtiWaitTimeoutMs;
    let startedBootstrapTokenJti =
      fixture.startedBootstrapTokenJtis[startedBootstrapTokenJtiCountBefore];
    while (startedBootstrapTokenJti === undefined) {
      const remainingMs = waitDeadlineMs - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Timed out waiting for workflow fixture to capture bootstrap token JTI.");
      }

      await fixture.sql`select pg_sleep(${Math.min(remainingMs, StartedBootstrapTokenJtiPollIntervalMs) / 1000})`;
      startedBootstrapTokenJti =
        fixture.startedBootstrapTokenJtis[startedBootstrapTokenJtiCountBefore];
    }
    await fixture.sql`
      insert into data_plane.sandbox_tunnel_connect_acks (bootstrap_token_jti)
      values (${startedBootstrapTokenJti})
    `;
    const result = await resultPromise;

    expect(result.sandboxInstanceId).not.toBe("");
    expect(result.providerSandboxId).not.toBe("");

    const persistedRows = await fixture.sql<
      {
        id: string;
        organization_id: string;
        sandbox_profile_id: string;
        sandbox_profile_version: number;
        provider: string;
        provider_sandbox_id: string | null;
        status: string;
        started_by_kind: string;
        started_by_id: string;
        source: string;
        started_at: string | null;
      }[]
    >`
      select
        id,
        organization_id,
        sandbox_profile_id,
        sandbox_profile_version,
        provider,
        provider_sandbox_id,
        status,
        started_by_kind,
        started_by_id,
        source,
        started_at
      from data_plane.sandbox_instances
      where id = ${result.sandboxInstanceId}
    `;

    expect(persistedRows).toHaveLength(1);

    const persistedRow = persistedRows[0];
    if (persistedRow === undefined) {
      throw new Error("Expected one persisted sandbox instance row.");
    }

    expect(persistedRow.provider).toBe("docker");
    expect(persistedRow.provider_sandbox_id).toBe(result.providerSandboxId);
    expect(persistedRow.status).toBe("running");
    expect(persistedRow.started_by_kind).toBe("user");
    expect(persistedRow.source).toBe("dashboard");
    expect(persistedRow.started_at).not.toBeNull();

    await fixture.sandboxAdapter.stop({ sandboxId: result.providerSandboxId });
  }, 120_000);

  it("stops sandbox and marks sandbox instance failed when tunnel connect ack times out", async ({
    fixture,
  }) => {
    const organizationId = `org-timeout-${randomUUID()}`;
    const sandboxProfileId = `sbp-timeout-${randomUUID()}`;
    const startedSandboxCountBefore = fixture.startedSandboxIds.length;

    const handle = await fixture.openWorkflow.runWorkflow(StartSandboxInstanceWorkflowSpec, {
      organizationId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      startedBy: {
        kind: "user",
        id: `usr-${randomUUID()}`,
      },
      source: "dashboard",
      image: createDockerBaseImageHandle("registry:3"),
    });

    await expect(handle.result({ timeoutMs: 45_000 })).rejects.toThrow(
      "Sandbox tunnel connect acknowledgement timed out. Sandbox was stopped and sandbox instance was marked as failed.",
    );

    const startedSandboxId = fixture.startedSandboxIds[startedSandboxCountBefore];
    if (startedSandboxId === undefined) {
      throw new Error("Expected workflow to start sandbox before tunnel acknowledgement timeout.");
    }

    await expect(fixture.sandboxAdapter.stop({ sandboxId: startedSandboxId })).rejects.toThrow(
      /not found|404|resolve_container/i,
    );

    const persistedRows = await fixture.sql<
      {
        id: string;
        provider_sandbox_id: string | null;
        status: string;
        started_at: string | null;
        failed_at: string | null;
        failure_code: string | null;
        failure_message: string | null;
      }[]
    >`
      select
        id,
        provider_sandbox_id,
        status,
        started_at,
        failed_at,
        failure_code,
        failure_message
      from data_plane.sandbox_instances
      where
        organization_id = ${organizationId}
        and sandbox_profile_id = ${sandboxProfileId}
    `;

    expect(persistedRows).toHaveLength(1);
    const persistedRow = persistedRows[0];
    if (persistedRow === undefined) {
      throw new Error("Expected one persisted sandbox instance row for timeout case.");
    }
    expect(persistedRow.provider_sandbox_id).toBe(startedSandboxId);
    expect(persistedRow.status).toBe("failed");
    expect(persistedRow.started_at).toBeNull();
    expect(persistedRow.failed_at).not.toBeNull();
    expect(persistedRow.failure_code).toBe("tunnel_connect_ack_timeout");
    expect(persistedRow.failure_message).toBe("Sandbox tunnel connect acknowledgement timed out.");
  }, 120_000);

  it("rolls back docker sandbox creation when persistence fails", async ({ fixture }) => {
    await fixture.sql.unsafe(
      `alter table data_plane.sandbox_instances add constraint ${FORBIDDEN_ORGANIZATION_CONSTRAINT} check (organization_id <> '${FORBIDDEN_ORGANIZATION_ID}')`,
    );

    const startedSandboxCountBefore = fixture.startedSandboxIds.length;

    try {
      const handle = await fixture.openWorkflow.runWorkflow(StartSandboxInstanceWorkflowSpec, {
        organizationId: FORBIDDEN_ORGANIZATION_ID,
        sandboxProfileId: `sbp-${randomUUID()}`,
        sandboxProfileVersion: 1,
        startedBy: {
          kind: "user",
          id: `usr-${randomUUID()}`,
        },
        source: "dashboard",
        image: createDockerBaseImageHandle("registry:3"),
      });

      await expect(handle.result({ timeoutMs: 45_000 })).rejects.toThrow(
        "Failed to persist sandbox instance after provider sandbox start. Provider sandbox was stopped.",
      );

      const startedSandboxId = fixture.startedSandboxIds[startedSandboxCountBefore];
      if (startedSandboxId === undefined) {
        throw new Error("Expected workflow to start a sandbox before persistence failure.");
      }

      await expect(fixture.sandboxAdapter.stop({ sandboxId: startedSandboxId })).rejects.toThrow(
        /not found|404|resolve_container/i,
      );

      const persistedRows = await fixture.sql`
        select id
        from data_plane.sandbox_instances
        where organization_id = ${FORBIDDEN_ORGANIZATION_ID}
      `;
      expect(persistedRows).toHaveLength(0);
    } finally {
      await fixture.sql.unsafe(
        `alter table data_plane.sandbox_instances drop constraint if exists ${FORBIDDEN_ORGANIZATION_CONSTRAINT}`,
      );
    }
  }, 120_000);
});
