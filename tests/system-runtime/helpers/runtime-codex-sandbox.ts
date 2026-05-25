import type { RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";

import { SandboxRuntimeStateSnapshotSchema } from "../../../packages/sandbox-runtime-contract/src/index.js";
import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.js";
import type {
  CodexSandboxAuthenticatedSession,
  CodexSandboxFixture,
  SystemSandboxProvider,
} from "../../system/helpers/codex-sandbox.js";

const InternalAuthServiceToken = "integration-new-internal-service-token";
const InternalAuthServiceTokenHeader = "x-mistle-service-token";
const TestEnvironmentIdHeader = "x-mistle-test-environment-id";

export function createRuntimeCodexSandboxFixture(
  system: RuntimeSystemTestEnvironment,
): CodexSandboxFixture {
  return {
    sandboxProvider: readSystemSandboxProvider(system),
    authSession: async (input): Promise<CodexSandboxAuthenticatedSession> => {
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
    controlPlaneApiBaseUrl: system.controlPlaneApi.hostBaseUrl,
    dataPlaneApiBaseUrl: system.dataPlaneApi.hostBaseUrl,
    dataPlaneApiHeaders: {
      [TestEnvironmentIdHeader]: system.id,
    },
    dataPlaneGatewayBaseUrl: withTestEnvironmentIdQueryParam({
      url: system.dataPlaneGateway.hostBaseUrl,
      environmentId: system.id,
    }),
    internalAuthServiceToken: InternalAuthServiceToken,
    createSessionRuntime: () =>
      createNodeSandboxSessionRuntime({
        headers: {
          [TestEnvironmentIdHeader]: system.id,
        },
      }),
    readSandboxRuntimeState: async (sandboxInstanceId) => {
      const response = await system.dataPlaneGateway.http.fetch(
        `/internal/sandbox-instances/${encodeURIComponent(sandboxInstanceId)}/runtime-state`,
        {
          headers: {
            [InternalAuthServiceTokenHeader]: InternalAuthServiceToken,
          },
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (response.status !== 200) {
        throw new Error(
          `Expected runtime-state read status 200, got ${String(response.status)}. Response body: ${JSON.stringify(payload)}`,
        );
      }

      return SandboxRuntimeStateSnapshotSchema.parse(payload);
    },
  };
}

function readSystemSandboxProvider(system: RuntimeSystemTestEnvironment): SystemSandboxProvider {
  if (system.sandbox === undefined) {
    throw new Error("Runtime Codex sandbox fixture requires a configured sandbox provider.");
  }

  return system.sandbox.provider;
}

function withTestEnvironmentIdQueryParam(input: { url: string; environmentId: string }): string {
  const url = new URL(input.url);
  url.searchParams.set(TestEnvironmentIdHeader, input.environmentId);
  return url.toString();
}
