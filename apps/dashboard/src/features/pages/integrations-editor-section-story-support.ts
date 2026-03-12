import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { QueryClient } from "@tanstack/react-query";

import { createGithubRepositoryResources } from "../forms/integration-resource-string-array-widget-story-support.js";
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

export const StoryOpenAiTarget: IntegrationTargetSummary = {
  targetKey: "target-openai",
  displayName: "OpenAI",
  familyId: "openai",
  variantId: "openai-default",
  config: {
    api_base_url: "https://api.openai.com",
    binding_capabilities: createOpenAiRawBindingCapabilities(),
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
    auth_scheme: "api-key",
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
    auth_scheme: "oauth",
  },
};

export const StoryIntegrationTargets = [StoryOpenAiTarget, StoryGithubTarget] as const;
export const StoryIntegrationConnections = [StoryOpenAiConnection, StoryGithubConnection] as const;

export const StoryGithubResources = createGithubRepositoryResources({
  connectionId: StoryGithubConnection.id,
});
