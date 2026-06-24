import { GitHubCloudBrowserDefinition } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createStoryWebhookTriggerCapabilitiesProviderMetadata } from "../integrations/integration-story-harness.js";
import { EditScheduledTriggerEditor } from "../pages/scheduled-trigger-editor-page.js";
import type { TriggerEditorFrameRenderer } from "../pages/trigger-editor-frame.js";
import { EditWebhookTriggerEditor } from "../pages/webhook-trigger-editor-page.js";
import { sandboxProfileVersionTriggerConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { PageFrame } from "../shared/page-frame.js";
import { ScheduledTriggerSameConversationKeyTemplate } from "./scheduled-trigger-form-helpers.js";
import type { ScheduledTrigger } from "./scheduled-triggers-types.js";
import {
  scheduledTriggerDetailQueryKey,
  triggerActivityQueryKey,
  webhookTriggerDetailQueryKey,
} from "./triggers-query-keys.js";
import type { TriggerActivityResult } from "./triggers-types.js";
import { TRIGGER_SANDBOX_PROFILES_QUERY_KEY } from "./use-trigger-sandbox-profile-options.js";
import {
  WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
} from "./use-webhook-trigger-prerequisites.js";
import type { WebhookTrigger } from "./webhook-triggers-types.js";

const StorySandboxProfileId = "sbp_story_editor_tabs";
const StoryGitHubConnectionId = "icn_story_editor_tabs_github";
const StoryGitHubWebhookSourceId = "iws_story_editor_tabs_github";
const StoryWebhookTriggerId = "atm_story_editor_tabs_webhook";
const StoryScheduledTriggerId = "atm_story_editor_tabs_schedule";

type TriggerEditorTabsStoryKind = "webhook" | "schedule";

const WebhookActivity: TriggerActivityResult = {
  kind: "webhook",
  items: [
    {
      id: "iwe_story_tab_recent",
      sourceOccurredAt: "2026-06-24T07:15:00.000Z",
      finalizedAt: "2026-06-24T07:15:04.000Z",
      eventType: "github.pull_request.opened",
      providerEventType: "pull_request",
      externalDeliveryId: "github-delivery-1042",
      status: "processed",
    },
    {
      id: "iwe_story_tab_failed",
      sourceOccurredAt: "2026-06-24T06:55:00.000Z",
      finalizedAt: "2026-06-24T06:55:02.000Z",
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      externalDeliveryId: "github-delivery-1038",
      status: "failed",
    },
  ],
};

const ScheduledActivity: TriggerActivityResult = {
  kind: "schedule",
  items: [
    {
      id: "sca_story_tab_upcoming",
      scheduledAt: "2026-06-25T01:00:00.000Z",
      localScheduledDate: "2026-06-25",
      localScheduledTime: "09:00",
      status: "pending",
    },
    {
      id: "sca_story_tab_dispatched",
      scheduledAt: "2026-06-24T01:00:00.000Z",
      localScheduledDate: "2026-06-24",
      localScheduledTime: "09:00",
      status: "dispatched",
    },
  ],
};

const WebhookTriggerDetail: WebhookTrigger = {
  id: StoryWebhookTriggerId,
  kind: "webhook",
  name: "GitHub pull request triage",
  enabled: true,
  integrationWebhookSourceId: StoryGitHubWebhookSourceId,
  eventConditions: [{ eventType: "pull_request" }],
  inputTemplate: "Review the pull request and summarize the impact.",
  instructions: "Keep the response concise and call out risky changes.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:{{payload.pull_request.number}}",
  idempotencyKeyTemplate: null,
  target: {
    id: "att_story_editor_tabs_webhook",
    sandboxProfileId: StorySandboxProfileId,
    sandboxProfileVersion: 3,
    primaryRepositoryId: null,
  },
  createdAt: "2026-06-20T01:00:00.000Z",
  updatedAt: "2026-06-24T07:20:00.000Z",
};

const ScheduledTriggerDetail: ScheduledTrigger = {
  id: StoryScheduledTriggerId,
  kind: "schedule",
  name: "Daily repository triage",
  enabled: true,
  schedule: {
    id: "sch_story_editor_tabs_schedule",
    kind: "recurring",
    name: "Daily repository triage",
    cronExpression: "0 9 * * 1-5",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-06-25T01:00:00.000Z",
    lastScheduledAt: "2026-06-24T01:00:00.000Z",
    startAt: null,
  },
  inputTemplate: "Review open work and prepare a triage summary.",
  conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
  idempotencyKeyTemplate: null,
  target: {
    id: "att_story_editor_tabs_schedule",
    sandboxProfileId: StorySandboxProfileId,
    sandboxProfileVersion: 3,
    primaryRepositoryId: null,
  },
  createdAt: "2026-06-20T01:00:00.000Z",
  updatedAt: "2026-06-24T07:20:00.000Z",
};

function createStoryQueryClient(kind: TriggerEditorTabsStoryKind): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        retryOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(TRIGGER_SANDBOX_PROFILES_QUERY_KEY, [
    {
      id: StorySandboxProfileId,
      displayName: "Repo Maintainer",
      activeVersion: 3,
    },
  ]);
  queryClient.setQueryData(
    sandboxProfileVersionTriggerConfigQueryKey({
      profileId: StorySandboxProfileId,
      version: 3,
    }),
    {
      bindings: [
        {
          id: "bnd_story_editor_tabs_github",
          sandboxProfileId: StorySandboxProfileId,
          sandboxProfileVersion: 3,
          connectionId: StoryGitHubConnectionId,
          kind: "git",
          config: {},
          createdAt: "2026-06-20T01:00:00.000Z",
          updatedAt: "2026-06-24T07:20:00.000Z",
        },
      ],
      repositoryOptions: [],
    },
  );

  if (kind === "webhook") {
    queryClient.setQueryData(
      webhookTriggerDetailQueryKey(StoryWebhookTriggerId),
      WebhookTriggerDetail,
    );
    queryClient.setQueryData(triggerActivityQueryKey(StoryWebhookTriggerId), WebhookActivity);
    queryClient.setQueryData(WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections: [
        {
          id: StoryGitHubConnectionId,
          targetKey: "github-cloud",
          displayName: "GitHub Engineering",
          status: "active",
          createdAt: "2026-06-20T01:00:00.000Z",
          updatedAt: "2026-06-24T07:20:00.000Z",
        },
      ],
      targets: [
        {
          targetKey: "github-cloud",
          familyId: GitHubCloudBrowserDefinition.familyId,
          variantId: GitHubCloudBrowserDefinition.variantId,
          kind: GitHubCloudBrowserDefinition.kind,
          enabled: true,
          config: {},
          displayName: GitHubCloudBrowserDefinition.displayName,
          description: "GitHub repositories",
          ...(GitHubCloudBrowserDefinition.logoKey === undefined
            ? {}
            : { logoKey: GitHubCloudBrowserDefinition.logoKey }),
          supportedWebhookEvents: GitHubCloudBrowserDefinition.supportedWebhookEvents,
          targetHealth: {
            configStatus: "valid",
          },
        },
      ],
    });
    queryClient.setQueryData(
      [...WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, StoryGitHubConnectionId],
      [
        {
          id: StoryGitHubWebhookSourceId,
          targetKey: "github-cloud",
          integrationConnectionId: StoryGitHubConnectionId,
          displayName: "GitHub Engineering webhook",
          endpointKey: "ep_story_editor_tabs_github",
          status: "active",
          providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
            definition: GitHubCloudBrowserDefinition,
            events: ["pull_request"],
            permissions: [{ permission: "pull_requests", access: "read" }],
          }),
          createdAt: "2026-06-20T01:00:00.000Z",
          updatedAt: "2026-06-24T07:20:00.000Z",
        },
      ],
    );
  } else {
    queryClient.setQueryData(
      scheduledTriggerDetailQueryKey(StoryScheduledTriggerId),
      ScheduledTriggerDetail,
    );
    queryClient.setQueryData(triggerActivityQueryKey(StoryScheduledTriggerId), ScheduledActivity);
  }

  return queryClient;
}

function TriggerEditorTabsStoryHarness(input: {
  kind: TriggerEditorTabsStoryKind;
}): React.JSX.Element {
  const [queryClient] = useState(() => createStoryQueryClient(input.kind));
  const renderFrame: TriggerEditorFrameRenderer = (frameInput) => (
    <PageFrame title="Edit trigger" width={frameInput.state === "unavailable" ? "normal" : "form"}>
      {frameInput.children}
    </PageFrame>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {input.kind === "webhook" ? (
        <EditWebhookTriggerEditor
          triggerId={StoryWebhookTriggerId}
          deleteSuccessPath="/triggers"
          navigate={async () => {}}
          renderFrame={renderFrame}
        />
      ) : (
        <EditScheduledTriggerEditor
          triggerId={StoryScheduledTriggerId}
          deleteSuccessPath="/triggers"
          navigate={async () => {}}
          renderFrame={renderFrame}
        />
      )}
    </QueryClientProvider>
  );
}

/** Shows the real edit-page tab navigation used to switch between trigger details and activity. */
const meta = {
  title: "Dashboard/Triggers/EditorTabs",
  component: TriggerEditorTabsStoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    kind: "webhook",
  },
} satisfies Meta<typeof TriggerEditorTabsStoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WebhookEditor: Story = {
  args: {
    kind: "webhook",
  },
};

export const ScheduledEditor: Story = {
  args: {
    kind: "schedule",
  },
};
