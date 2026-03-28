import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-internal-client";
import {
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxProvider, createSandboxAdapter } from "@mistle/sandbox";
import { describe, expect } from "vitest";

import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "../src/internal/index.js";
import { it } from "./test-context.js";

describe("internal sandbox instances get integration", () => {
  it("returns pending before provider provisioning begins", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_pending",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      sandboxProfileVersion: 0,
      runtimeProvider: "docker",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_pending?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_pending",
      status: "pending",
      failureCode: null,
      failureMessage: null,
    });
  });

  it("returns running from provider inspection for a running sandbox", async ({ fixture }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_running",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_running?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_running",
        status: "running",
        failureCode: null,
        failureMessage: null,
      });
    } finally {
      await adapter.destroy({ id: sandbox.id });
    }
  }, 60_000);

  it("marks starting sandboxes failed when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_starting_missing",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      sandboxProfileVersion: 4,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_starting_missing?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_starting_missing",
      status: "failed",
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_starting_missing"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
    });
  }, 60_000);

  it("surfaces running from inspection for starting sandboxes without mutating the row", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_starting",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_starting?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_starting",
        status: "running",
        failureCode: null,
        failureMessage: null,
      });

      const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
        },
        where: (table, { eq }) => eq(table.id, "sbi_conventional_get_starting"),
      });
      expect(persistedRow?.status).toBe(SandboxInstanceStatuses.STARTING);
    } finally {
      await adapter.destroy({ id: sandbox.id });
    }
  }, 60_000);

  it("marks running sandboxes failed when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_missing",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      sandboxProfileVersion: 3,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_missing?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_missing",
      status: "failed",
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_missing"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
  }, 60_000);
});
