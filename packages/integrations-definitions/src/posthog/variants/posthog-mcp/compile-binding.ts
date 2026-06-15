import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { PostHogCredentialSecretTypes, PostHogCredentialSlotKeys, PostHogMcpUrl } from "./auth.js";
import type { PostHogBindingConfig } from "./binding-config-schema.js";
import { PostHogToolIds } from "./tool-ids.js";

export type PostHogCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  PostHogBindingConfig
>;

function createPostHogMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.posthog.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: PostHogMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: PostHogCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: PostHogCredentialSlotKeys.accessToken,
    },
  };
}

export function compilePostHogBinding(input: PostHogCompileBindingInput): CompileBindingResult {
  const includesPostHogMcp = input.binding.config.tools.includes(PostHogToolIds.POSTHOG_MCP);

  return {
    egressRoutes: includesPostHogMcp
      ? [
          createPostHogMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
