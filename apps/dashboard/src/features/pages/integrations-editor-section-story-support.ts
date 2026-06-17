import type {
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookEventParameterGroupDefinition,
} from "@mistle/integrations-core";
import {
  GitHubAssociatedResourceEventsCapability,
  GoogleWorkspaceMcpServerIds,
  PlanetScaleToolIds,
  SlackAssociatedResourceEventsCapability,
  WasenderApiToolIds,
  WhapiToolIds,
} from "@mistle/integrations-definitions";
import { QueryClient } from "@tanstack/react-query";

import { createGithubRepositoryResources } from "../forms/integration-resource-picker-story-support.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";

type SupportedAssociatedResourceEvents = NonNullable<
  IntegrationTargetSummary["supportedAssociatedResourceEvents"]
>;
type SupportedAssociatedResourceEvent = SupportedAssociatedResourceEvents[number];
type SupportedAssociatedResourceEventParameter = NonNullable<
  SupportedAssociatedResourceEvent["parameters"]
>[number];
type SupportedAssociatedResourceEventParameterGroup = NonNullable<
  SupportedAssociatedResourceEvent["parameterGroups"]
>[number];

export function createIntegrationsEditorSectionStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

export function seedStoryIntegrationResources(input: {
  queryClient: QueryClient;
  resources: IntegrationConnectionResources;
}): void {
  input.queryClient.setQueryData(
    [
      "integration-connections",
      input.resources.connectionId,
      "resources",
      input.resources.kind,
      "",
    ],
    input.resources,
  );
}

export const StoryOpenAiTarget: IntegrationTargetSummary = {
  targetKey: "target-openai",
  displayName: "OpenAI",
  logoKey: "openai",
  familyId: "openai",
  variantId: "openai-default",
  config: {
    api_base_url: "https://api.openai.com",
  },
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryOpenAiConnection: IntegrationConnectionSummary = {
  id: "connection-openai",
  displayName: "Primary OpenAI Workspace",
  targetKey: StoryOpenAiTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StoryAnthropicTarget: IntegrationTargetSummary = {
  targetKey: "target-anthropic",
  displayName: "Anthropic",
  logoKey: "anthropic",
  familyId: "anthropic",
  variantId: "anthropic-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryAnthropicConnection: IntegrationConnectionSummary = {
  id: "connection-anthropic",
  displayName: "Anthropic Production",
  targetKey: StoryAnthropicTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StoryOpenCodeGoTarget: IntegrationTargetSummary = {
  targetKey: "target-opencode-go",
  displayName: "OpenCode Go",
  logoKey: "opencode",
  familyId: "opencode",
  variantId: "opencode-go",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryOpenCodeGoConnection: IntegrationConnectionSummary = {
  id: "connection-opencode-go",
  displayName: "OpenCode Go Production",
  targetKey: StoryOpenCodeGoTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StoryGithubTarget: IntegrationTargetSummary = {
  targetKey: "target-github",
  displayName: "GitHub",
  logoKey: "github",
  familyId: "github",
  variantId: "github-cloud",
  config: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetHealth: {
    configStatus: "valid",
  },
  supportedAssociatedResourceEvents: createStoryGithubAssociatedResourceEvents(),
};

export const StoryGithubConnection: IntegrationConnectionSummary = {
  id: "connection-github",
  displayName: "GitHub Production",
  targetKey: StoryGithubTarget.targetKey,
  status: "active",
  resources: [
    {
      kind: "repository",
      selectionMode: "multi",
      count: 24,
      syncState: "ready",
      lastSyncedAt: "2026-03-09T12:00:00.000Z",
    },
  ],
  config: {
    connection_method: "github-app-installation",
    app_id: "123",
    app_slug: "mistle-github-app",
    client_id: "Iv1.story-client",
    installation_id: "12345",
  },
};

export const StoryGithubEnterpriseServerTarget: IntegrationTargetSummary = {
  targetKey: "target-github-enterprise-server",
  displayName: "GitHub Enterprise Server",
  logoKey: "github",
  familyId: "github",
  variantId: "github-enterprise-server",
  config: {
    api_base_url: "https://github.acme.example/api/v3",
    web_base_url: "https://github.acme.example",
  },
  targetHealth: {
    configStatus: "valid",
  },
  supportedAssociatedResourceEvents: createStoryGithubAssociatedResourceEvents(),
};

export const StoryGithubEnterpriseServerConnection: IntegrationConnectionSummary = {
  id: "connection-github-enterprise-server",
  displayName: "GitHub Enterprise Server Production",
  targetKey: StoryGithubEnterpriseServerTarget.targetKey,
  status: "active",
  resources: [
    {
      kind: "repository",
      selectionMode: "multi",
      count: 12,
      syncState: "ready",
      lastSyncedAt: "2026-03-09T13:00:00.000Z",
    },
  ],
  config: {
    connection_method: "github-app-installation",
    app_id: "88421",
    app_slug: "mistle-ghes",
    client_id: "Iv1.story-ghes-client",
    installation_id: "8842101",
  },
};

export const StoryGoogleWorkspaceTarget: IntegrationTargetSummary = {
  targetKey: "target-google-workspace",
  displayName: "Google Workspace",
  logoKey: "google-workspace",
  familyId: "google-workspace",
  variantId: "google-workspace-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryGoogleWorkspaceConnection: IntegrationConnectionSummary = {
  id: "connection-google-workspace",
  displayName: "Google Workspace Production",
  targetKey: StoryGoogleWorkspaceTarget.targetKey,
  status: "active",
  config: {
    connection_method: "oauth2-authorization-code",
    client_id: "google-workspace-story-client",
  },
};

export const StoryAwsTarget: IntegrationTargetSummary = {
  targetKey: "target-aws",
  displayName: "AWS",
  logoKey: "aws",
  familyId: "aws",
  variantId: "aws-cli-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryAwsConnection: IntegrationConnectionSummary = {
  id: "connection-aws",
  displayName: "AWS Production",
  targetKey: StoryAwsTarget.targetKey,
  status: "active",
  config: {
    connection_method: "aws-assume-role",
    accessKeyId: "AKIASTORYACCESSKEY",
    roleArn: "arn:aws:iam::123456789012:role/mistle-story-role",
    externalId: "mistle-story-external-id",
    durationSeconds: 3600,
  },
};

export const StoryDatadogTarget: IntegrationTargetSummary = {
  targetKey: "target-datadog",
  displayName: "Datadog",
  logoKey: "datadog",
  familyId: "datadog",
  variantId: "datadog-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryDatadogConnection: IntegrationConnectionSummary = {
  id: "connection-datadog",
  displayName: "Datadog Production",
  targetKey: StoryDatadogTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StoryJiraTarget: IntegrationTargetSummary = {
  targetKey: "target-jira",
  displayName: "Jira",
  logoKey: "jira",
  familyId: "jira",
  variantId: "jira-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryJiraConnection: IntegrationConnectionSummary = {
  id: "connection-jira",
  displayName: "Jira Production",
  targetKey: StoryJiraTarget.targetKey,
  status: "active",
  config: {
    connection_method: "jira-personal-api-token",
    site_url: "https://mistle.atlassian.net",
    email: "user@example.com",
  },
};

export const StoryLinearTarget: IntegrationTargetSummary = {
  targetKey: "target-linear",
  displayName: "Linear",
  logoKey: "linear",
  familyId: "linear",
  variantId: "linear-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryLinearConnection: IntegrationConnectionSummary = {
  id: "connection-linear",
  displayName: "Linear Workspace",
  targetKey: StoryLinearTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StoryPlanetScaleTarget: IntegrationTargetSummary = {
  targetKey: "target-planetscale",
  displayName: "PlanetScale",
  logoKey: "planetscale",
  familyId: "planetscale",
  variantId: "planetscale-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryPlanetScaleConnection: IntegrationConnectionSummary = {
  id: "connection-planetscale",
  displayName: "PlanetScale Production",
  targetKey: StoryPlanetScaleTarget.targetKey,
  status: "active",
  config: {
    connection_method: "oauth2-authorization-code",
    client_id: "planetscale-story-client",
  },
};

export const StorySignozTarget: IntegrationTargetSummary = {
  targetKey: "target-signoz",
  displayName: "SigNoz",
  logoKey: "signoz",
  familyId: "signoz",
  variantId: "signoz-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StorySignozConnection: IntegrationConnectionSummary = {
  id: "connection-signoz",
  displayName: "SigNoz Cloud",
  targetKey: StorySignozTarget.targetKey,
  status: "active",
  config: {
    connection_method: "oauth2-authorization-code",
    region: "us",
    client_id: "signoz-story-client",
  },
};

export const StoryWasenderApiTarget: IntegrationTargetSummary = {
  targetKey: "target-wasenderapi",
  displayName: "WasenderAPI",
  logoKey: "wasenderapi",
  familyId: "wasenderapi",
  variantId: "wasenderapi-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryWasenderApiConnection: IntegrationConnectionSummary = {
  id: "connection-wasenderapi",
  displayName: "WasenderAPI Production",
  targetKey: StoryWasenderApiTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StorySupabaseTarget: IntegrationTargetSummary = {
  targetKey: "target-supabase",
  displayName: "Supabase",
  logoKey: "supabase",
  familyId: "supabase",
  variantId: "supabase-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StorySupabaseConnection: IntegrationConnectionSummary = {
  id: "connection-supabase",
  displayName: "Supabase Production",
  targetKey: StorySupabaseTarget.targetKey,
  status: "active",
  config: {
    connection_method: "oauth2-authorization-code",
    client_id: "supabase-story-client",
  },
};

export const StoryWhapiTarget: IntegrationTargetSummary = {
  targetKey: "target-whapi",
  displayName: "Whapi",
  logoKey: "whapi",
  familyId: "whapi",
  variantId: "whapi-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

export const StoryWhapiConnection: IntegrationConnectionSummary = {
  id: "connection-whapi",
  displayName: "Whapi Support Channel",
  targetKey: StoryWhapiTarget.targetKey,
  status: "active",
  config: {
    connection_method: "api-key",
  },
};

export const StorySlackTarget: IntegrationTargetSummary = {
  targetKey: "target-slack",
  displayName: "Slack",
  logoKey: "slack",
  familyId: "slack",
  variantId: "slack-default",
  config: {
    api_base_url: "https://slack.com/api",
  },
  targetHealth: {
    configStatus: "valid",
  },
  supportedAssociatedResourceEvents: createStorySlackAssociatedResourceEvents(),
};

export const StorySlackConnection: IntegrationConnectionSummary = {
  id: "connection-slack",
  displayName: "Slack Workspace",
  targetKey: StorySlackTarget.targetKey,
  status: "active",
  config: {
    connection_method: "slack-bot-token",
    bot_user_id: "U_STORY_BOT",
  },
};

export const StoryIntegrationTargets = [
  StoryOpenAiTarget,
  StoryAnthropicTarget,
  StoryOpenCodeGoTarget,
  StoryGithubTarget,
  StoryGithubEnterpriseServerTarget,
  StoryGoogleWorkspaceTarget,
  StoryAwsTarget,
  StoryDatadogTarget,
  StoryJiraTarget,
  StoryLinearTarget,
  StoryPlanetScaleTarget,
  StorySignozTarget,
  StoryWasenderApiTarget,
  StoryWhapiTarget,
  StorySlackTarget,
] as const;
export const StoryIntegrationConnections = [
  StoryOpenAiConnection,
  StoryAnthropicConnection,
  StoryOpenCodeGoConnection,
  StoryGithubConnection,
  StoryGithubEnterpriseServerConnection,
  StoryGoogleWorkspaceConnection,
  StoryAwsConnection,
  StoryDatadogConnection,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryPlanetScaleConnection,
  StorySignozConnection,
  StoryWasenderApiConnection,
  StoryWhapiConnection,
  StorySlackConnection,
] as const;

export const StoryGithubResources = createGithubRepositoryResources({
  connectionId: StoryGithubConnection.id,
});

export const StoryGithubEnterpriseServerResources = createGithubRepositoryResources({
  connectionId: StoryGithubEnterpriseServerConnection.id,
});

function createStoryGithubAssociatedResourceEvents(): SupportedAssociatedResourceEvents {
  const supportedEvents = GitHubAssociatedResourceEventsCapability.supportedEvents;
  if (supportedEvents === undefined) {
    throw new Error("GitHub story target requires supported associated resource events.");
  }

  return supportedEvents.map((eventDefinition) => ({
    resourceKind: eventDefinition.resourceKind,
    eventType: eventDefinition.eventType,
    displayName: eventDefinition.displayName,
    ...(eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: eventDefinition.parameters.map(cloneStoryAssociatedResourceEventParameter),
        }),
    ...(eventDefinition.parameterGroups === undefined
      ? {}
      : {
          parameterGroups: eventDefinition.parameterGroups.map(
            cloneStoryAssociatedResourceEventParameterGroup,
          ),
        }),
  }));
}

function createStorySlackAssociatedResourceEvents(): SupportedAssociatedResourceEvents {
  const supportedEvents = SlackAssociatedResourceEventsCapability.supportedEvents;
  if (supportedEvents === undefined) {
    throw new Error("Slack story target requires supported associated resource events.");
  }

  return supportedEvents.map((eventDefinition) => ({
    resourceKind: eventDefinition.resourceKind,
    eventType: eventDefinition.eventType,
    displayName: eventDefinition.displayName,
    ...(eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: eventDefinition.parameters.map(cloneStoryAssociatedResourceEventParameter),
        }),
    ...(eventDefinition.parameterGroups === undefined
      ? {}
      : {
          parameterGroups: eventDefinition.parameterGroups.map(
            cloneStoryAssociatedResourceEventParameterGroup,
          ),
        }),
  }));
}

function cloneStoryAssociatedResourceEventParameter(
  parameter: IntegrationWebhookEventParameterDefinition,
): SupportedAssociatedResourceEventParameter {
  switch (parameter.kind) {
    case "resource-select":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        resourceKind: parameter.resourceKind,
        payloadPath: [...parameter.payloadPath],
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
    case "string":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        payloadPath: [...parameter.payloadPath],
        ...(parameter.matchMode === undefined ? {} : { matchMode: parameter.matchMode }),
        ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue }),
        ...(parameter.defaultEnabled === undefined
          ? {}
          : { defaultEnabled: parameter.defaultEnabled }),
        ...(parameter.controlVariant === undefined
          ? {}
          : { controlVariant: parameter.controlVariant }),
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
    case "enum-select":
      return {
        id: parameter.id,
        label: parameter.label,
        kind: parameter.kind,
        payloadPath: [...parameter.payloadPath],
        matchMode: parameter.matchMode,
        options: parameter.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
        ...(parameter.negatedMatchRequiresExists === undefined
          ? {}
          : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
        ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
        ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
      };
  }
}

function cloneStoryAssociatedResourceEventParameterGroup(
  parameterGroup: IntegrationWebhookEventParameterGroupDefinition,
): SupportedAssociatedResourceEventParameterGroup {
  return {
    id: parameterGroup.id,
    label: parameterGroup.label,
    kind: parameterGroup.kind,
    options: parameterGroup.options.map((option) => ({
      parameterId: option.parameterId,
      label: option.label,
    })),
  };
}

export const StoryIntegrationResources = [
  StoryGithubResources,
  StoryGithubEnterpriseServerResources,
] as const;

export const StoryPlanetScaleTools = [
  PlanetScaleToolIds.PLANETSCALE_MCP,
  PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
] as const;

export const StoryWasenderApiTools = [WasenderApiToolIds.WASENDERAPI_MCP] as const;

export const StoryWhapiTools: readonly string[] = [WhapiToolIds.WHAPI_MCP];

export const StoryGoogleWorkspaceTools = [
  GoogleWorkspaceMcpServerIds.GMAIL,
  GoogleWorkspaceMcpServerIds.DRIVE,
  GoogleWorkspaceMcpServerIds.CALENDAR,
] as const;
