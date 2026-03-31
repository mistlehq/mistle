import { sandboxInstances } from "@mistle/db/data-plane";
import {
  derivePublishedTargetHost,
  verifyPublishedTargetAccessToken,
  verifyPublishedTargetShareToken,
} from "@mistle/published-target-auth";
import { afterEach, describe, expect } from "vitest";

import {
  IntegrationPublishedTargetAccessTokenIssuer,
  IntegrationPublishedTargetAccessTokenSecret,
  IntegrationPublishedTargetBaseDomain,
} from "../../data-plane-api/integration/runtime-status-test-helpers.js";
import { createControlPlaneApiRuntime } from "../src/main.js";
import {
  SandboxInstancePortPublishSchema,
  SandboxInstanceShareLinkSchema,
  SandboxInstancesNotFoundResponseSchema,
} from "../src/sandbox-instances/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const IntegrationConnectionTokenConfig = {
  secret: "integration-connection-secret",
  issuer: "integration-issuer",
  audience: "integration-audience",
} as const;

const IntegrationPublishedTargetConfig = {
  environment: "development",
  baseDomain: IntegrationPublishedTargetBaseDomain,
  accessToken: {
    tokenSecret: IntegrationPublishedTargetAccessTokenSecret,
    tokenIssuer: IntegrationPublishedTargetAccessTokenIssuer,
    tokenAudience: "integration-data-plane-gateway",
  },
  shareToken: {
    tokenSecret: IntegrationPublishedTargetAccessTokenSecret,
    tokenIssuer: IntegrationPublishedTargetAccessTokenIssuer,
    tokenAudience: "integration-data-plane-gateway",
  },
} as const;

const IntegrationSandboxRuntimeConfig = {
  defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
} as const;

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }
});

function createControlPlaneConfig(input: {
  baseConfig: ControlPlaneApiConfig;
  dataPlaneBaseUrl: string;
}): ControlPlaneApiConfig {
  return {
    ...input.baseConfig,
    dataPlaneApi: {
      baseUrl: input.dataPlaneBaseUrl,
    },
  };
}

async function createRuntime(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  dataPlaneBaseUrl: string;
}) {
  return createControlPlaneApiRuntime({
    app: createControlPlaneConfig({
      baseConfig: input.fixture.config,
      dataPlaneBaseUrl: input.dataPlaneBaseUrl,
    }),
    internalAuthServiceToken: input.fixture.internalAuthServiceToken,
    connectionToken: IntegrationConnectionTokenConfig,
    publishedTarget: IntegrationPublishedTargetConfig,
    sandbox: IntegrationSandboxRuntimeConfig,
  });
}

async function insertSandboxInstance(input: {
  dataPlaneFixture: DisposableDataPlaneRuntime;
  organizationId: string;
  sandboxInstanceId: string;
}) {
  await input.dataPlaneFixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_publish_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: "running",
    startedByKind: "user",
    startedById: "usr_publish_integration",
    source: "dashboard",
    failureCode: null,
    failureMessage: null,
  });
}

describe("sandbox instance publish integration", () => {
  it("mints a published-target token and canonical host for one sandbox port", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_publish",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createRuntime({
      fixture,
      dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
    });

    try {
      const authSession = await fixture.authSession({
        email: "integration-sandbox-publish@example.com",
      });
      const sandboxInstanceId = "sbi_cp_publish_001";
      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${sandboxInstanceId}/ports/5173/publish`,
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(201);
      const body = SandboxInstancePortPublishSchema.parse(await response.json());
      const expectedHost = derivePublishedTargetHost({
        baseDomain: IntegrationPublishedTargetConfig.baseDomain,
        sandboxInstanceId,
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(body.host).toBe(expectedHost);

      const verifiedToken = await verifyPublishedTargetAccessToken({
        config: IntegrationPublishedTargetConfig.accessToken,
        token: body.token,
      });
      expect(verifiedToken.host).toBe(expectedHost);
      expect(verifiedToken.organizationId).toBe(authSession.organizationId);
      expect(verifiedToken.sandboxInstanceId).toBe(sandboxInstanceId);
      expect(verifiedToken.targetId).toBe("5173");
      expect(verifiedToken.userId).toBe(authSession.userId);
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("mints a short-lived share URL for one sandbox port", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_publish",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createRuntime({
      fixture,
      dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
    });

    try {
      const authSession = await fixture.authSession({
        email: "integration-sandbox-share@example.com",
      });
      const sandboxInstanceId = "sbi_cp_share_001";
      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId,
      });

      const response = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/share`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authSession.cookie,
          },
          body: JSON.stringify({
            expiresInSeconds: 900,
          }),
        },
      );

      expect(response.status).toBe(201);
      const body = SandboxInstanceShareLinkSchema.parse(await response.json());
      const shareUrl = new URL(body.shareUrl);
      const expectedHost = derivePublishedTargetHost({
        baseDomain: IntegrationPublishedTargetConfig.baseDomain,
        sandboxInstanceId,
        target: {
          kind: "port",
          port: 4173,
        },
      });
      expect(shareUrl.host).toBe(expectedHost);

      const token = shareUrl.searchParams.get("token");
      if (token === null) {
        throw new Error("Expected shareUrl to contain a token query parameter.");
      }

      const verifiedToken = await verifyPublishedTargetShareToken({
        config: IntegrationPublishedTargetConfig.shareToken,
        token,
      });
      expect(verifiedToken.host).toBe(expectedHost);
      expect(verifiedToken.sandboxInstanceId).toBe(sandboxInstanceId);
      expect(verifiedToken.targetId).toBe("4173");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("does not mint publish or share access for another organization's sandbox instance", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_publish",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createRuntime({
      fixture,
      dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
    });

    try {
      const ownerSession = await fixture.authSession({
        email: "integration-sandbox-share-owner@example.com",
      });
      const otherSession = await fixture.authSession({
        email: "integration-sandbox-share-other@example.com",
      });
      const sandboxInstanceId = "sbi_cp_share_002";
      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: ownerSession.organizationId,
        sandboxInstanceId,
      });

      const publishResponse = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${sandboxInstanceId}/ports/3000/publish`,
        {
          method: "POST",
          headers: {
            cookie: otherSession.cookie,
          },
        },
      );
      expect(publishResponse.status).toBe(404);
      expect(SandboxInstancesNotFoundResponseSchema.parse(await publishResponse.json()).code).toBe(
        "INSTANCE_NOT_FOUND",
      );

      const shareResponse = await controlPlaneRuntime.request(
        `/v1/sandbox/instances/${sandboxInstanceId}/ports/3000/share`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: otherSession.cookie,
          },
          body: JSON.stringify({}),
        },
      );
      expect(shareResponse.status).toBe(404);
      expect(SandboxInstancesNotFoundResponseSchema.parse(await shareResponse.json()).code).toBe(
        "INSTANCE_NOT_FOUND",
      );
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});
