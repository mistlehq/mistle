import {
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import {
  AtlassianCredentialSecretTypes,
  AtlassianConnectionMethodIds,
  AtlassianConnectionConfigSchema,
  normalizeAtlassianBaseUrl,
  resolveAtlassianCredentialSecretType,
} from "./auth.js";
import type { AtlassianBindingConfig } from "./binding-config-schema.js";
import type { AtlassianTargetConfig } from "./target-config-schema.js";
import { AtlassianToolIds } from "./tool-ids.js";

export type AtlassianCompileBindingInput = CompileBindingInput<
  AtlassianTargetConfig,
  AtlassianBindingConfig
>;

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
        refs.githubReleases.installLatestTaggedAsset({
          repository: "mistlehq/tools",
          releaseTagPrefix: "jira/",
          assetName: "jira-linux-amd64",
          installPath: refs.artifactBinPath("jira"),
          format: "binary",
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

export function compileAtlassianBinding(input: AtlassianCompileBindingInput): CompileBindingResult {
  const parsedConnectionConfig = AtlassianConnectionConfigSchema.parse(input.connection.config);
  const credentialSecretType = resolveAtlassianCredentialSecretType(input.connection.config);
  const includesJiraCli = input.binding.config.tools.includes(AtlassianToolIds.JIRA_CLI);

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
      artifacts: includesJiraCli ? [createJiraCliArtifact(upstreamBaseUrl)] : [],
      runtimeClients: [],
    };
  }

  const upstreamBaseUrl = `https://api.atlassian.com/ex/jira/${parsedConnectionConfig.cloud_id}`;

  if (
    parsedConnectionConfig.connection_method ===
    AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS
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
            connectionId: input.connection.id,
            secretType: AtlassianCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
            purpose: AtlassianCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          },
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
          connectionId: input.connection.id,
          secretType: credentialSecretType,
        },
      },
    ],
    artifacts: includesJiraCli ? [createJiraCliArtifact(upstreamBaseUrl)] : [],
    runtimeClients: [],
  };
}
