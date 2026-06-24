import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { TriggerActivitySection } from "./trigger-activity-section.js";
import { triggerActivityQueryKey } from "./triggers-query-keys.js";
import type { TriggerActivityResult } from "./triggers-types.js";

const StoryWebhookTriggerId = "atm_story_webhook_activity";
const StoryScheduledTriggerId = "atm_story_schedule_activity";
const StoryEmptyWebhookTriggerId = "atm_story_empty_webhook_activity";

const WebhookActivity: TriggerActivityResult = {
  kind: "webhook",
  items: [
    {
      id: "iwe_story_webhook_recent",
      sourceOccurredAt: "2026-06-24T06:42:00.000Z",
      finalizedAt: "2026-06-24T06:42:03.000Z",
      eventType: "github.pull_request.opened",
      providerEventType: "pull_request",
      externalDeliveryId: "github-delivery-9931",
      status: "processed",
    },
    {
      id: "iwe_story_webhook_processing",
      sourceOccurredAt: "2026-06-24T06:39:00.000Z",
      finalizedAt: null,
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      externalDeliveryId: "github-delivery-9928",
      status: "processing",
    },
    {
      id: "iwe_story_webhook_duplicate",
      sourceOccurredAt: "2026-06-24T06:34:00.000Z",
      finalizedAt: "2026-06-24T06:34:02.000Z",
      eventType: "github.pull_request.opened",
      providerEventType: "pull_request",
      externalDeliveryId: "github-delivery-9924",
      status: "duplicate",
    },
    {
      id: "iwe_story_webhook_missing_source_time",
      sourceOccurredAt: null,
      finalizedAt: "2026-06-24T06:20:00.000Z",
      eventType: "github.push.deleted",
      providerEventType: "push",
      externalDeliveryId: null,
      status: "ignored",
    },
  ],
};

const ScheduledActivity: TriggerActivityResult = {
  kind: "schedule",
  items: [
    {
      id: "sca_story_schedule_upcoming",
      scheduledAt: "2026-06-25T01:00:00.000Z",
      localScheduledDate: "2026-06-25",
      localScheduledTime: "09:00",
      status: "pending",
    },
    {
      id: "sca_story_schedule_dispatched",
      scheduledAt: "2026-06-24T01:00:00.000Z",
      localScheduledDate: "2026-06-24",
      localScheduledTime: "09:00",
      status: "dispatched",
    },
    {
      id: "sca_story_schedule_failed",
      scheduledAt: "2026-06-23T01:00:00.000Z",
      localScheduledDate: "2026-06-23",
      localScheduledTime: "09:00",
      status: "failed",
    },
    {
      id: "sca_story_schedule_skipped_late",
      scheduledAt: "2026-06-22T01:00:00.000Z",
      localScheduledDate: "2026-06-22",
      localScheduledTime: "09:00",
      status: "skipped_late",
    },
  ],
};

const EmptyWebhookActivity: TriggerActivityResult = {
  kind: "webhook",
  items: [],
};

function createTriggerActivityStoryQueryClient(input: {
  triggerId: string;
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

  queryClient.setQueryData(triggerActivityQueryKey(input.triggerId), input.activity);

  return queryClient;
}

function TriggerActivityStoryHarness(input: {
  triggerId: string;
  activity: TriggerActivityResult;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createTriggerActivityStoryQueryClient({
      triggerId: input.triggerId,
      activity: input.activity,
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TriggerActivitySection triggerId={input.triggerId} />
    </QueryClientProvider>
  );
}

/** Shows the recent trigger source activity table used on webhook and scheduled trigger editors. */
const meta = {
  title: "Dashboard/Triggers/ActivitySection",
  component: TriggerActivityStoryHarness,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TriggerActivityStoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WebhookEvents: Story = {
  args: {
    triggerId: StoryWebhookTriggerId,
    activity: WebhookActivity,
  },
};

export const ScheduledActions: Story = {
  args: {
    triggerId: StoryScheduledTriggerId,
    activity: ScheduledActivity,
  },
};

export const EmptyWebhook: Story = {
  args: {
    triggerId: StoryEmptyWebhookTriggerId,
    activity: EmptyWebhookActivity,
  },
};
