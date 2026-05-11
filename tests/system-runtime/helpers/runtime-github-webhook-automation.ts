import { TestEnvironmentIdHeader } from "@mistle/test-harness/integration";
import type { RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";

import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.js";
import type {
  AuthenticatedSession,
  GitHubWebhookAutomationFixture,
} from "../../system/helpers/github-webhook-automation.js";

export function createRuntimeGitHubWebhookAutomationFixture(
  system: RuntimeSystemTestEnvironment,
): GitHubWebhookAutomationFixture {
  const { publicAccess } = system;
  return {
    authSession: async (input): Promise<AuthenticatedSession> => {
      const session = await system.env.auth.createSession({
        ...(input?.email === undefined ? {} : { email: input.email }),
      });

      return {
        cookie: session.cookie,
        organizationId: session.organizationId,
        userId: session.userId,
      };
    },
    request: async (path, init) => system.controlPlaneApi.http.fetch(path, init),
    db: system.env.controlPlaneDb,
    dataPlaneGatewayBaseUrl: withTestEnvironmentIdQueryParam({
      url: system.dataPlaneGateway.hostBaseUrl,
      environmentId: system.id,
    }),
    testContextId: system.id,
    testEnvironmentId: system.id,
    ...(publicAccess === undefined
      ? {}
      : {
          readPublicAccessDiagnostics: async () => await publicAccess.readDiagnostics(),
        }),
    createSessionRuntime: () =>
      createNodeSandboxSessionRuntime({
        headers: {
          [TestEnvironmentIdHeader]: system.id,
        },
      }),
  };
}

function withTestEnvironmentIdQueryParam(input: { url: string; environmentId: string }): string {
  const url = new URL(input.url);
  url.searchParams.set(TestEnvironmentIdHeader, input.environmentId);
  return url.toString();
}
