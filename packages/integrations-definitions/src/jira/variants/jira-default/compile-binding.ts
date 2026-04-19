import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import {
  JiraCredentialSecretTypes,
  JiraCredentialSlotKeys,
  JiraConnectionMethodIds,
  JiraConnectionConfigSchema,
  normalizeJiraBaseUrl,
  resolveJiraCredentialSecretType,
} from "./auth.js";
import type { JiraBindingConfig } from "./binding-config-schema.js";
import { JiraRequestMiddlewareIds } from "./egress-request-middleware.js";
import type { JiraTargetConfig } from "./target-config-schema.js";
import { JiraToolIds } from "./tool-ids.js";

export type JiraCompileBindingInput = CompileBindingInput<JiraTargetConfig, JiraBindingConfig>;

const JiraCliArtifactKey = "jira-cli";
const JiraCliArtifactName = "Jira CLI";
const ArtifactCommandTimeoutMs = 120_000;

function createJiraCliArtifact(upstreamBaseUrl: string): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: JiraCliArtifactKey,
    name: JiraCliArtifactName,
    env: {
      JIRA_BASE_URL: upstreamBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "latest_matching_prefix",
            prefix: "jira/",
          },
          asset: {
            kind: "exact",
            fileName: "jira-linux-amd64",
            format: "binary",
          },
          installPath: refs.artifactBinPath("jira"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

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

export function compileJiraBinding(input: JiraCompileBindingInput): CompileBindingResult {
  const parsedConnectionConfig = JiraConnectionConfigSchema.parse(input.connection.config);
  const credentialSecretType = resolveJiraCredentialSecretType(input.connection.config);
  const includesJiraCli = input.binding.config.tools.includes(JiraToolIds.JIRA_CLI);

  if (parsedConnectionConfig.connection_method === JiraConnectionMethodIds.PERSONAL_API_TOKEN) {
    const upstreamBaseUrl = normalizeJiraBaseUrl(parsedConnectionConfig.site_url);

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
            kind: "integration_connection",
            connectionId: input.connection.id,
            secretType: credentialSecretType,
            slotKey: JiraCredentialSlotKeys.PERSONAL_API_TOKEN_API_KEY,
          },
          requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
        },
      ],
      artifacts: includesJiraCli ? [createJiraCliArtifact(upstreamBaseUrl)] : [],
      runtimeClients: [],
    };
  }

  const upstreamBaseUrl = `https://api.atlassian.com/ex/jira/${parsedConnectionConfig.cloud_id}`;

  if (
    parsedConnectionConfig.connection_method ===
    JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS
  ) {
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
            kind: "integration_connection",
            connectionId: input.connection.id,
            secretType: JiraCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
            slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS_ACCESS_TOKEN,
          },
          requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
        },
      ],
      artifacts: includesJiraCli ? [createJiraCliArtifact(upstreamBaseUrl)] : [],
      runtimeClients: [],
    };
  }

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
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: credentialSecretType,
          slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_API_TOKEN_API_KEY,
        },
        requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
      },
    ],
    artifacts: includesJiraCli ? [createJiraCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: [],
  };
}
