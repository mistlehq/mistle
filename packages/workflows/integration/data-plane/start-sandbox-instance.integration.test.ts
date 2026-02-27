import { randomUUID } from "node:crypto";

import { SandboxImageKind, SandboxProvider } from "@mistle/sandbox";
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

function createDockerBaseImageHandle(imageId: string): StartSandboxInstanceWorkflowInput["image"] {
  return {
    provider: SandboxProvider.DOCKER,
    imageId,
    kind: SandboxImageKind.BASE,
    createdAt: new Date().toISOString(),
  };
}

function normalizePersistedManifest(manifest: unknown): unknown {
  if (typeof manifest === "string") {
    return JSON.parse(manifest);
  }

  return manifest;
}

describeDockerWorkflowIntegration("start sandbox instance workflow integration", () => {
  it("starts a docker sandbox and persists sandbox instance state", async ({ fixture }) => {
    const manifest: Record<string, unknown> = {
      command: ["echo", "hello"],
      env: {
        HELLO: "WORLD",
      },
    };

    const handle = await fixture.openWorkflow.runWorkflow(StartSandboxInstanceWorkflowSpec, {
      organizationId: `org-${randomUUID()}`,
      sandboxProfileId: `sbp-${randomUUID()}`,
      sandboxProfileVersion: 1,
      manifest,
      startedBy: {
        kind: "user",
        id: `usr-${randomUUID()}`,
      },
      source: "dashboard",
      image: createDockerBaseImageHandle("registry:3"),
    });

    const result = await handle.result({ timeoutMs: 45_000 });

    expect(result.sandboxInstanceId).not.toBe("");
    expect(result.providerSandboxId).not.toBe("");

    const persistedRows = await fixture.sql<
      {
        id: string;
        organization_id: string;
        sandbox_profile_id: string;
        sandbox_profile_version: number;
        manifest: unknown;
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
        manifest,
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

    expect(normalizePersistedManifest(persistedRow.manifest)).toEqual(manifest);
    expect(persistedRow.provider).toBe("docker");
    expect(persistedRow.provider_sandbox_id).toBe(result.providerSandboxId);
    expect(persistedRow.status).toBe("running");
    expect(persistedRow.started_by_kind).toBe("user");
    expect(persistedRow.source).toBe("dashboard");
    expect(persistedRow.started_at).not.toBeNull();

    await fixture.sandboxAdapter.stop({ sandboxId: result.providerSandboxId });
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
        manifest: {
          mode: "rollback-check",
        },
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
