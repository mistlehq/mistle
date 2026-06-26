import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createTriggerDetailPath } from "../triggers/trigger-editor-navigation.js";
import { triggerActivityQueryKey, triggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggerActivityResult, TriggerListItem } from "../triggers/triggers-types.js";
import { TriggerActivityContent } from "./trigger-activity-page.js";

const StoryWebhookTriggerId = "atm_story_activity_page_webhook";
const StoryScheduledTriggerId = "atm_story_activity_page_schedule";

const WebhookTrigger = {
  id: StoryWebhookTriggerId,
  kind: "webhook",
  name: "GitHub PR review",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/platform",
    primaryRepositoryName: "mistlehq/platform",
  },
  source: {
    kind: "webhook",
    events: [
      {
        label: "Pull request",
        logoKey: "github",
      },
    ],
  },
  updatedAt: "2026-06-24T06:45:00.000Z",
} satisfies TriggerListItem;

const ScheduledTrigger = {
  id: StoryScheduledTriggerId,
  kind: "schedule",
  name: "Daily repository triage",
  enabled: true,
  target: {
    sandboxProfileId: "sbp_repo_maintainer",
    sandboxProfileName: "Repo Maintainer",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/platform",
    primaryRepositoryName: "mistlehq/platform",
  },
  source: {
    kind: "schedule",
    cronExpression: "0 9 * * 1-5",
    timezone: "Asia/Singapore",
    nextScheduledAt: "2026-06-25T01:00:00.000Z",
  },
  updatedAt: "2026-06-24T06:45:00.000Z",
} satisfies TriggerListItem;

const WebhookActivity = {
  kind: "webhook",
  items: [
    {
      id: "iwe_story_activity_page_recent",
      sourceOccurredAt: "2026-06-24T06:42:00.000Z",
      finalizedAt: "2026-06-24T06:42:03.000Z",
      eventType: "github.pull_request.opened",
      providerEventType: "pull_request",
      externalDeliveryId: "github-delivery-9931",
      status: "processed",
    },
    {
      id: "iwe_story_activity_page_processing",
      sourceOccurredAt: "2026-06-24T06:39:00.000Z",
      finalizedAt: null,
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      externalDeliveryId: "github-delivery-9928",
      status: "processing",
    },
    {
      id: "iwe_story_activity_page_duplicate",
      sourceOccurredAt: "2026-06-24T06:34:00.000Z",
      finalizedAt: "2026-06-24T06:34:02.000Z",
      eventType: "github.pull_request.opened",
      providerEventType: "pull_request",
      externalDeliveryId: "github-delivery-9924",
      status: "duplicate",
    },
    {
      id: "iwe_story_activity_page_missing_source_time",
      sourceOccurredAt: null,
      finalizedAt: "2026-06-24T06:20:00.000Z",
      eventType: "github.push.deleted",
      providerEventType: "push",
      externalDeliveryId: null,
      status: "ignored",
    },
  ],
} satisfies TriggerActivityResult;

const ScheduledActivity = {
  kind: "schedule",
  items: [
    {
      id: "sca_story_activity_page_upcoming",
      scheduledAt: "2026-06-25T01:00:00.000Z",
      localScheduledDate: "2026-06-25",
      localScheduledTime: "09:00",
      status: "pending",
    },
    {
      id: "sca_story_activity_page_dispatched",
      scheduledAt: "2026-06-24T01:00:00.000Z",
      localScheduledDate: "2026-06-24",
      localScheduledTime: "09:00",
      status: "dispatched",
    },
    {
      id: "sca_story_activity_page_failed",
      scheduledAt: "2026-06-23T01:00:00.000Z",
      localScheduledDate: "2026-06-23",
      localScheduledTime: "09:00",
      status: "failed",
    },
    {
      id: "sca_story_activity_page_skipped_late",
      scheduledAt: "2026-06-22T01:00:00.000Z",
      localScheduledDate: "2026-06-22",
      localScheduledTime: "09:00",
      status: "skipped_late",
    },
  ],
} satisfies TriggerActivityResult;

const EmptyWebhookActivity = {
  kind: "webhook",
  items: [],
} satisfies TriggerActivityResult;

function createTriggerActivityPageQueryClient(input: {
  trigger: TriggerListItem;
  activity: TriggerActivityResult;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(triggerDetailQueryKey(input.trigger.id), input.trigger);
  queryClient.setQueryData(triggerActivityQueryKey(input.trigger.id), input.activity);

  return queryClient;
}

function TriggerActivityPageStoryHarness(input: {
  trigger: TriggerListItem;
  activity: TriggerActivityResult;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createTriggerActivityPageQueryClient({
      trigger: input.trigger,
      activity: input.activity,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TriggerActivityContent
        triggerId={input.trigger.id}
        backPath={createTriggerDetailPath(input.trigger.id)}
        navigate={() => {}}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/ActivityPage",
  component: TriggerActivityPageStoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TriggerActivityPageStoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WebhookEvents: Story = {
  args: {
    trigger: WebhookTrigger,
    activity: WebhookActivity,
  },
};

export const ScheduledRuns: Story = {
  args: {
    trigger: ScheduledTrigger,
    activity: ScheduledActivity,
  },
};

export const EmptyWebhook: Story = {
  args: {
    trigger: WebhookTrigger,
    activity: EmptyWebhookActivity,
  },
};
