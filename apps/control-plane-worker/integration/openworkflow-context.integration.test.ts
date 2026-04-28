import { getLocalTestSandboxBaseImageRef } from "@mistle/config";
import { describe, expect } from "vitest";

import { closeWorkflowContext, getWorkflowContext } from "../openworkflow/core/context.js";
import { closeOpenWorkflowRuntime, getOpenWorkflowRuntime } from "../openworkflow/core/runtime.js";
import type { ControlPlaneWorkerIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const LocalTestSandboxBaseImageRef = getLocalTestSandboxBaseImageRef();

function assignEnvironment(overrides: Record<string, string | undefined>): () => void {
  const previousEntries = Object.entries(overrides).map(
    ([key]) => [key, process.env[key]] as const,
  );

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  };
}

function createWorkerEnvironment(
  fixture: ControlPlaneWorkerIntegrationFixture,
): Record<string, string> {
  return {
    NODE_ENV: "development",
    MISTLE_TELEMETRY_ENABLED: "false",
    MISTLE_TELEMETRY_DEBUG: "false",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: fixture.internalAuthServiceToken,
    MISTLE_SANDBOX_PROVIDER: "docker",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: LocalTestSandboxBaseImageRef,
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: "ws://127.0.0.1:8084/tunnel/sandbox",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
      "ws://127.0.0.1:8084/tunnel/sandbox",
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-connect-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "control-plane-api",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-bootstrap-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "data-plane-worker",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-egress-token-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-token-secret",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "control-plane-api",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "data-plane-gateway",
    MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: "integration-publish-cookie-secret",
    MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: fixture.databaseStack.directUrl,
    MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: fixture.config.workflow.namespaceId,
    MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: String(
      fixture.config.workflow.concurrency,
    ),
    MISTLE_EMAIL_SMTP_FROM_ADDRESS: fixture.config.email.fromAddress,
    MISTLE_EMAIL_SMTP_FROM_NAME: fixture.config.email.fromName,
    MISTLE_EMAIL_SMTP_HOST: fixture.config.email.smtpHost,
    MISTLE_EMAIL_SMTP_PORT: String(fixture.config.email.smtpPort),
    MISTLE_EMAIL_SMTP_SECURE: String(fixture.config.email.smtpSecure),
    MISTLE_EMAIL_SMTP_USERNAME: fixture.config.email.smtpUsername,
    MISTLE_EMAIL_SMTP_PASSWORD: fixture.config.email.smtpPassword,
    MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: fixture.config.dataPlaneApi.baseUrl,
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: fixture.config.controlPlaneApi.baseUrl,
  };
}

describe("openworkflow worker context integration", () => {
  it("memoizes runtime and recreates workflow context after close", async ({ fixture }) => {
    const restoreEnvironment = assignEnvironment({
      MISTLE_CONFIG_PATH: undefined,
      ...createWorkerEnvironment(fixture),
    });

    try {
      const runtime = await getOpenWorkflowRuntime();
      const memoizedRuntime = await getOpenWorkflowRuntime();
      expect(memoizedRuntime).toBe(runtime);
      expect(runtime.workerConfig.workflow.databaseUrl).toBe(fixture.databaseStack.directUrl);

      const workflowContext = await getWorkflowContext();
      const memoizedWorkflowContext = await getWorkflowContext();
      expect(memoizedWorkflowContext).toBe(workflowContext);
      expect(workflowContext.dbPool.ended).toBeFalsy();

      await closeWorkflowContext();
      expect(workflowContext.dbPool.ended).toBeTruthy();

      const recreatedWorkflowContext = await getWorkflowContext();
      expect(recreatedWorkflowContext).not.toBe(workflowContext);
      expect(recreatedWorkflowContext.dbPool.ended).toBeFalsy();

      await closeWorkflowContext();
    } finally {
      await closeWorkflowContext();
      await closeOpenWorkflowRuntime();
      restoreEnvironment();
    }
  }, 60_000);
});
