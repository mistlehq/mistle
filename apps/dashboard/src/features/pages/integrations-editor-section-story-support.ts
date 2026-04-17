import {
  PlanetScaleToolIds,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
} from "@mistle/integrations-definitions";
import { QueryClient } from "@tanstack/react-query";

import { createGithubRepositoryResources } from "../forms/integration-resource-string-array-widget-story-support.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";

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
  familyId: "openai",
  variantId: "openai-default",
  config: {
    api_base_url: "https://api.openai.com",
    binding_capabilities_by_connection_method:
      createOpenAiRawBindingCapabilitiesByConnectionMethod(),
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

export const StoryGithubTarget: IntegrationTargetSummary = {
  targetKey: "target-github",
  displayName: "GitHub",
  familyId: "github",
  variantId: "github-cloud",
  config: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetHealth: {
    configStatus: "valid",
  },
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
    installation_id: "12345",
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

export const StoryIntegrationTargets = [
  StoryOpenAiTarget,
  StoryGithubTarget,
  StoryJiraTarget,
  StoryLinearTarget,
  StoryPlanetScaleTarget,
] as const;
export const StoryIntegrationConnections = [
  StoryOpenAiConnection,
  StoryGithubConnection,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryPlanetScaleConnection,
] as const;

export const StoryGithubResources = createGithubRepositoryResources({
  connectionId: StoryGithubConnection.id,
});

export const StoryPlanetScaleTools = [
  PlanetScaleToolIds.PLANETSCALE_MCP,
  PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
] as const;
