import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import {
  AtlassianConnectionMethodIds,
  AtlassianConnectionConfigSchema,
  normalizeAtlassianBaseUrl,
  resolveAtlassianCredentialSecretType,
} from "./auth.js";
import type { AtlassianBindingConfig } from "./binding-config-schema.js";
import type { AtlassianTargetConfig } from "./target-config-schema.js";

export type AtlassianCompileBindingInput = CompileBindingInput<
  AtlassianTargetConfig,
  AtlassianBindingConfig
>;

function resolveMatchFromBaseUrl(baseUrl: string): {
  hosts: string[];
  pathPrefixes?: string[];
} {
  const parsedBaseUrl = new URL(baseUrl);
  const pathPrefix = resolveRoutePathPrefixFromBaseUrl(baseUrl);

  if (pathPrefix === "/") {
    return {
      hosts: [parsedBaseUrl.host],
    };
  }

  return {
    hosts: [parsedBaseUrl.host],
    pathPrefixes: [pathPrefix],
  };
}

export function compileAtlassianBinding(input: AtlassianCompileBindingInput): CompileBindingResult {
  const parsedConnectionConfig = AtlassianConnectionConfigSchema.parse(input.connection.config);
  const credentialSecretType = resolveAtlassianCredentialSecretType(input.connection.config);

  if (
    parsedConnectionConfig.connection_method === AtlassianConnectionMethodIds.PERSONAL_API_TOKEN
  ) {
    const upstreamBaseUrl = normalizeAtlassianBaseUrl(parsedConnectionConfig.site_url);

    return {
      egressRoutes: [
        {
          match: resolveMatchFromBaseUrl(upstreamBaseUrl),
          upstream: {
            baseUrl: upstreamBaseUrl,
          },
          authInjection: {
            type: "basic",
            target: "authorization",
            username: parsedConnectionConfig.email,
          },
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: credentialSecretType,
          },
        },
      ],
      artifacts: [],
      runtimeClients: [],
    };
  }

  const upstreamBaseUrl = `https://api.atlassian.com/ex/jira/${parsedConnectionConfig.cloud_id}`;

  return {
    egressRoutes: [
      {
        match: resolveMatchFromBaseUrl(upstreamBaseUrl),
        upstream: {
          baseUrl: upstreamBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: input.connection.id,
          secretType: credentialSecretType,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
