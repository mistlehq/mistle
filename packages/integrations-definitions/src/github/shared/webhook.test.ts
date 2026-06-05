import type { IntegrationConnection } from "@mistle/integrations-core";
import GitHubWebhookDefinitions from "@octokit/webhooks-examples/api.github.com/index.json" with { type: "json" };
import { sign } from "@octokit/webhooks-methods";
import type {
  CheckSuiteCompletedEvent,
  IssueCommentCreatedEvent,
  IssuesOpenedEvent,
  PullRequestOpenedEvent,
  PullRequestReviewSubmittedEvent,
  PushEvent,
  PullRequestReviewCommentCreatedEvent,
  WebhookEventName,
} from "@octokit/webhooks-types";
import { describe, expect, it } from "vitest";

import { GitHubSupportedWebhookEvents } from "./supported-webhook-events.js";
import { GitHubWebhookHandler } from "./webhook.server.js";

const encoder = new TextEncoder();

type InstallationContext = {
  installation: {
    id: number | string;
  };
};

type WebhookDefinitionShape = {
  name: string;
  examples: ReadonlyArray<unknown>;
};

type PushPayloadWithHeadCommit = PushEvent &
  InstallationContext & {
    head_commit: {
      timestamp: string;
    };
  };

const IssueCommentEventName: WebhookEventName = "issue_comment";
const PullRequestReviewCommentEventName: WebhookEventName = "pull_request_review_comment";
const PullRequestEventName: WebhookEventName = "pull_request";
const PullRequestReviewEventName: WebhookEventName = "pull_request_review";
const PushEventName: WebhookEventName = "push";
const CheckSuiteEventName: WebhookEventName = "check_suite";

function encodePayload(input: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(input));
}

function isPayloadRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function toPayloadRecord(input: unknown): Record<string, unknown> {
  if (!isPayloadRecord(input)) {
    throw new Error("Expected webhook payload to be a JSON object.");
  }

  return { ...input };
}

function createGitHubCloudTargetConfig() {
  return {
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    secrets: {},
    config: {
      apiBaseUrl: "https://api.github.com/",
      webBaseUrl: "https://github.com/",
    },
  };
}

function createConnection(): IntegrationConnection {
  return {
    id: "icn_123",
    status: "active",
    externalSubjectId: IssueCommentCreatedPayload.installation.id.toString(),
    config: {},
  };
}

function createParsedEvent(input?: {
  eventType?: string;
  providerEventType?: string;
  payload?: unknown;
}) {
  return {
    externalEventId: "delivery_123",
    externalDeliveryId: "delivery_123",
    providerEventType: input?.providerEventType ?? "issue_comment",
    eventType: input?.eventType ?? "github.issue_comment.created",
    payload:
      input?.payload === undefined
        ? toPayloadRecord(IssueCommentCreatedPayload)
        : toPayloadRecord(input.payload),
  };
}

function hasAction(input: unknown): input is { action: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "action" in input &&
    typeof input.action === "string"
  );
}

function hasInstallationContext(input: unknown): input is InstallationContext {
  return (
    typeof input === "object" &&
    input !== null &&
    "installation" in input &&
    typeof input.installation === "object" &&
    input.installation !== null &&
    "id" in input.installation &&
    (typeof input.installation.id === "number" || typeof input.installation.id === "string")
  );
}

function isWebhookDefinitionShape(input: unknown): input is WebhookDefinitionShape {
  return (
    typeof input === "object" &&
    input !== null &&
    "name" in input &&
    typeof input.name === "string" &&
    "examples" in input &&
    Array.isArray(input.examples)
  );
}

function hasPushHeadCommit(input: unknown): input is PushPayloadWithHeadCommit {
  return (
    hasInstallationContext(input) &&
    "head_commit" in input &&
    typeof input.head_commit === "object" &&
    input.head_commit !== null &&
    "timestamp" in input.head_commit &&
    typeof input.head_commit.timestamp === "string"
  );
}

function resolveWebhookDefinition(name: WebhookEventName): WebhookDefinitionShape {
  const definition = GitHubWebhookDefinitions.find(
    (candidate) => isWebhookDefinitionShape(candidate) && candidate.name === name,
  );

  if (definition === undefined || !isWebhookDefinitionShape(definition)) {
    throw new Error(`Missing GitHub webhook definition for event: ${name}`);
  }

  return definition;
}

function resolveIssueCommentCreatedPayload(): IssueCommentCreatedEvent & InstallationContext {
  const definition = resolveWebhookDefinition(IssueCommentEventName);
  const example = definition.examples.find(
    (candidate): candidate is IssueCommentCreatedEvent & InstallationContext =>
      hasAction(candidate) && candidate.action === "created" && hasInstallationContext(candidate),
  );

  if (example === undefined) {
    throw new Error(
      "Missing GitHub webhook example with installation for event issue_comment.created",
    );
  }

  return example;
}

function resolveIssuesOpenedPayload(): IssuesOpenedEvent & InstallationContext {
  const definition = resolveWebhookDefinition("issues");
  const example = definition.examples.find(
    (candidate): candidate is IssuesOpenedEvent =>
      hasAction(candidate) && candidate.action === "opened",
  );

  if (example === undefined) {
    throw new Error("Missing GitHub webhook example for event issues.opened");
  }

  return withInstallation(example);
}

function resolvePullRequestReviewCommentCreatedPayload(): PullRequestReviewCommentCreatedEvent &
  InstallationContext {
  const definition = resolveWebhookDefinition(PullRequestReviewCommentEventName);
  const example = definition.examples.find(
    (candidate): candidate is PullRequestReviewCommentCreatedEvent & InstallationContext =>
      hasAction(candidate) && candidate.action === "created" && hasInstallationContext(candidate),
  );

  if (example === undefined) {
    throw new Error(
      "Missing GitHub webhook example with installation for event pull_request_review_comment.created",
    );
  }

  return example;
}

function resolvePullRequestReviewSubmittedPayload(): PullRequestReviewSubmittedEvent &
  InstallationContext {
  const definition = resolveWebhookDefinition(PullRequestReviewEventName);
  const example = definition.examples.find(
    (candidate): candidate is PullRequestReviewSubmittedEvent & InstallationContext =>
      hasAction(candidate) && candidate.action === "submitted" && hasInstallationContext(candidate),
  );

  if (example === undefined) {
    throw new Error(
      "Missing GitHub webhook example with installation for event pull_request_review.submitted",
    );
  }

  return example;
}

function resolvePullRequestOpenedPayload(): PullRequestOpenedEvent & InstallationContext {
  const definition = resolveWebhookDefinition(PullRequestEventName);
  const example = definition.examples.find(
    (candidate): candidate is PullRequestOpenedEvent & InstallationContext =>
      hasAction(candidate) && candidate.action === "opened" && hasInstallationContext(candidate),
  );

  if (example === undefined) {
    throw new Error(
      "Missing GitHub webhook example with installation for event pull_request.opened",
    );
  }

  return example;
}

function resolveCheckSuiteCompletedPayload(): CheckSuiteCompletedEvent & InstallationContext {
  const definition = resolveWebhookDefinition(CheckSuiteEventName);
  const example = definition.examples.find(
    (candidate): candidate is CheckSuiteCompletedEvent =>
      hasAction(candidate) && candidate.action === "completed",
  );

  if (example === undefined) {
    throw new Error("Missing GitHub webhook example for event check_suite.completed");
  }

  return withInstallation(example);
}

function resolvePushPayload(): PushPayloadWithHeadCommit {
  const definition = resolveWebhookDefinition(PushEventName);
  const example = definition.examples.find((candidate): candidate is PushPayloadWithHeadCommit =>
    hasPushHeadCommit(candidate),
  );

  if (example === undefined) {
    throw new Error(
      "Missing GitHub webhook example with installation and head_commit for event push",
    );
  }

  return example;
}

function withoutInstallation<TPayload extends InstallationContext>(
  payload: TPayload,
): Omit<TPayload, "installation"> {
  const { installation: _installation, ...rest } = payload;
  return rest;
}

function withInstallation<TPayload extends object>(
  payload: TPayload,
): TPayload & InstallationContext {
  return {
    ...payload,
    installation: {
      id: IssueCommentCreatedPayload.installation.id,
    },
  };
}

function createMinimalGitHubPayload(input: {
  action?: string;
  body: Record<string, unknown>;
}): Record<string, unknown> & InstallationContext {
  return {
    ...(input.action === undefined ? {} : { action: input.action }),
    installation: {
      id: IssueCommentCreatedPayload.installation.id,
    },
    repository: {
      full_name: "mistlehq/mistle",
    },
    sender: {
      login: "octocat",
    },
    ...input.body,
  };
}

function sortedStrings(input: ReadonlyArray<string>): string[] {
  return [...input].sort();
}

function requireStringValue(input: { label: string; value: string | null | undefined }): string {
  if (typeof input.value === "string" && input.value.length > 0) {
    return input.value;
  }

  throw new Error(`Expected ${input.label} to be a non-empty string.`);
}

const IssueCommentCreatedPayload: IssueCommentCreatedEvent & InstallationContext =
  resolveIssueCommentCreatedPayload();

const IssuesOpenedPayload: IssuesOpenedEvent & InstallationContext = resolveIssuesOpenedPayload();

const PullRequestReviewCommentCreatedPayload: PullRequestReviewCommentCreatedEvent &
  InstallationContext = resolvePullRequestReviewCommentCreatedPayload();

const PullRequestReviewSubmittedPayload: PullRequestReviewSubmittedEvent & InstallationContext =
  resolvePullRequestReviewSubmittedPayload();

const PullRequestOpenedPayload: PullRequestOpenedEvent & InstallationContext =
  resolvePullRequestOpenedPayload();

const IssuesClosedPayload = createMinimalGitHubPayload({
  action: "closed",
  body: {
    issue: {
      id: 1102,
      number: 43,
      closed_at: "2026-04-02T17:42:43Z",
    },
  },
});

const IssuesReopenedPayload = createMinimalGitHubPayload({
  action: "reopened",
  body: {
    issue: {
      id: 1103,
      number: 44,
      updated_at: "2026-04-02T17:43:43Z",
    },
  },
});

const PullRequestClosedPayload = createMinimalGitHubPayload({
  action: "closed",
  body: {
    number: 45,
    pull_request: {
      id: 2102,
      number: 45,
      closed_at: "2026-04-02T17:44:43Z",
    },
  },
});

const PullRequestReopenedPayload = createMinimalGitHubPayload({
  action: "reopened",
  body: {
    number: 46,
    pull_request: {
      id: 2103,
      number: 46,
      updated_at: "2026-04-02T17:45:43Z",
    },
  },
});

const PullRequestSynchronizePayload = createMinimalGitHubPayload({
  action: "synchronize",
  body: {
    number: 47,
    after: "8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f",
    pull_request: {
      id: 2104,
      number: 47,
      updated_at: "2026-04-02T17:46:43Z",
    },
  },
});

const PullRequestReadyForReviewPayload = createMinimalGitHubPayload({
  action: "ready_for_review",
  body: {
    number: 48,
    pull_request: {
      id: 2105,
      number: 48,
      updated_at: "2026-04-02T17:47:43Z",
    },
  },
});

const PullRequestReviewRequestedPayload = createMinimalGitHubPayload({
  action: "review_requested",
  body: {
    number: 49,
    pull_request: {
      id: 2106,
      number: 49,
      updated_at: "2026-04-02T17:48:43Z",
    },
    requested_reviewer: {
      id: 3101,
      login: "mistle-agent",
    },
  },
});

const PullRequestTeamReviewRequestedPayload = createMinimalGitHubPayload({
  action: "review_requested",
  body: {
    number: 50,
    pull_request: {
      id: 2107,
      number: 50,
      updated_at: "2026-04-02T17:49:43Z",
    },
    requested_team: {
      id: 3201,
      slug: "platform-reviewers",
    },
  },
});

const PullRequestReviewRequestRemovedPayload = createMinimalGitHubPayload({
  action: "review_request_removed",
  body: {
    number: 51,
    pull_request: {
      id: 2108,
      number: 51,
      updated_at: "2026-04-02T17:50:43Z",
    },
    requested_reviewer: {
      id: 3102,
      login: "mistle-agent",
    },
  },
});

const PullRequestReviewRequestedWithoutActorPayload = createMinimalGitHubPayload({
  action: "review_requested",
  body: {
    number: 52,
    pull_request: {
      id: 2109,
      number: 52,
      updated_at: "2026-04-02T17:51:43Z",
    },
  },
});

const PullRequestReviewRequestedWithoutActorIdPayload = createMinimalGitHubPayload({
  action: "review_requested",
  body: {
    number: 53,
    pull_request: {
      id: 2110,
      number: 53,
      updated_at: "2026-04-02T17:52:43Z",
    },
    requested_reviewer: {
      login: "mistle-agent",
    },
  },
});

const PullRequestReviewRequestedWithReviewerAndTeamPayload = createMinimalGitHubPayload({
  action: "review_requested",
  body: {
    number: 54,
    pull_request: {
      id: 2111,
      number: 54,
      updated_at: "2026-04-02T17:53:43Z",
    },
    requested_reviewer: {
      id: 3103,
      login: "mistle-agent",
    },
    requested_team: {
      id: 3202,
      slug: "platform-reviewers",
    },
  },
});

const PushPayload: PushPayloadWithHeadCommit = resolvePushPayload();
const CheckSuiteCompletedPayload: CheckSuiteCompletedEvent & InstallationContext =
  resolveCheckSuiteCompletedPayload();

const SupportedGitHubOrderingCases: ReadonlyArray<{
  providerEventType: WebhookEventName;
  eventType: string;
  deliveryId: string;
  payload: unknown;
  expectedOccurredAt: string;
  expectedOrderingIdentifier: string;
}> = [
  {
    providerEventType: "issues",
    eventType: "github.issues.opened",
    deliveryId: "delivery_issues_opened",
    payload: IssuesOpenedPayload,
    expectedOccurredAt: IssuesOpenedPayload.issue.created_at,
    expectedOrderingIdentifier: IssuesOpenedPayload.issue.id.toString().padStart(20, "0"),
  },
  {
    providerEventType: "issues",
    eventType: "github.issues.closed",
    deliveryId: "delivery_issues_closed",
    payload: IssuesClosedPayload,
    expectedOccurredAt: "2026-04-02T17:42:43Z",
    expectedOrderingIdentifier: "00000000000000001102",
  },
  {
    providerEventType: "issues",
    eventType: "github.issues.reopened",
    deliveryId: "delivery_issues_reopened",
    payload: IssuesReopenedPayload,
    expectedOccurredAt: "2026-04-02T17:43:43Z",
    expectedOrderingIdentifier: "00000000000000001103",
  },
  {
    providerEventType: "issue_comment",
    eventType: "github.issue_comment.created",
    deliveryId: "delivery_issue_comment_created",
    payload: IssueCommentCreatedPayload,
    expectedOccurredAt: IssueCommentCreatedPayload.comment.created_at,
    expectedOrderingIdentifier: IssueCommentCreatedPayload.comment.id.toString().padStart(20, "0"),
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.opened",
    deliveryId: "delivery_pull_request_opened",
    payload: PullRequestOpenedPayload,
    expectedOccurredAt: PullRequestOpenedPayload.pull_request.created_at,
    expectedOrderingIdentifier: PullRequestOpenedPayload.pull_request.id
      .toString()
      .padStart(20, "0"),
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.closed",
    deliveryId: "delivery_pull_request_closed",
    payload: PullRequestClosedPayload,
    expectedOccurredAt: "2026-04-02T17:44:43Z",
    expectedOrderingIdentifier: "00000000000000002102",
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.reopened",
    deliveryId: "delivery_pull_request_reopened",
    payload: PullRequestReopenedPayload,
    expectedOccurredAt: "2026-04-02T17:45:43Z",
    expectedOrderingIdentifier: "00000000000000002103",
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.synchronize",
    deliveryId: "delivery_pull_request_synchronize",
    payload: PullRequestSynchronizePayload,
    expectedOccurredAt: "2026-04-02T17:46:43Z",
    expectedOrderingIdentifier: "8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f8f2f",
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.ready_for_review",
    deliveryId: "delivery_pull_request_ready_for_review",
    payload: PullRequestReadyForReviewPayload,
    expectedOccurredAt: "2026-04-02T17:47:43Z",
    expectedOrderingIdentifier: "00000000000000002105",
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.review_requested",
    deliveryId: "delivery_pull_request_review_requested",
    payload: PullRequestReviewRequestedPayload,
    expectedOccurredAt: "2026-04-02T17:48:43Z",
    expectedOrderingIdentifier: "00000000000000002106.00000000000000003101.1",
  },
  {
    providerEventType: "pull_request",
    eventType: "github.pull_request.review_request_removed",
    deliveryId: "delivery_pull_request_review_request_removed",
    payload: PullRequestReviewRequestRemovedPayload,
    expectedOccurredAt: "2026-04-02T17:50:43Z",
    expectedOrderingIdentifier: "00000000000000002108.00000000000000003102.2",
  },
  {
    providerEventType: "pull_request_review",
    eventType: "github.pull_request_review.submitted",
    deliveryId: "delivery_pull_request_review_submitted",
    payload: PullRequestReviewSubmittedPayload,
    expectedOccurredAt: requireStringValue({
      label: "pull_request_review.submitted review.submitted_at",
      value: PullRequestReviewSubmittedPayload.review.submitted_at,
    }),
    expectedOrderingIdentifier: PullRequestReviewSubmittedPayload.review.id
      .toString()
      .padStart(20, "0"),
  },
  {
    providerEventType: "pull_request_review_comment",
    eventType: "github.pull_request_review_comment.created",
    deliveryId: "delivery_pull_request_review_comment_created",
    payload: PullRequestReviewCommentCreatedPayload,
    expectedOccurredAt: PullRequestReviewCommentCreatedPayload.comment.created_at,
    expectedOrderingIdentifier: PullRequestReviewCommentCreatedPayload.comment.id
      .toString()
      .padStart(20, "0"),
  },
  {
    providerEventType: "push",
    eventType: "github.push.pushed",
    deliveryId: "delivery_push",
    payload: PushPayload,
    expectedOccurredAt: PushPayload.head_commit.timestamp,
    expectedOrderingIdentifier: PushPayload.after,
  },
  {
    providerEventType: "check_suite",
    eventType: "github.check_suite.completed",
    deliveryId: "delivery_check_suite_completed",
    payload: CheckSuiteCompletedPayload,
    expectedOccurredAt: CheckSuiteCompletedPayload.check_suite.updated_at,
    expectedOrderingIdentifier: CheckSuiteCompletedPayload.check_suite.id
      .toString()
      .padStart(20, "0"),
  },
];

describe("GitHubWebhookHandler", () => {
  it("verifies webhook signature with webhookSecret", async () => {
    const payloadString = JSON.stringify(IssueCommentCreatedPayload);
    const signature = await sign("whsec_123", payloadString);

    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {
        webhookSecret: "whsec_123",
      },
      webhookSourceSecrets: {},
      headers: {
        "x-hub-signature-256": signature,
      },
      rawBody: encoder.encode(payloadString),
    });

    expect(verificationResult).toEqual({
      ok: true,
    });
  });

  it("fails verification when webhook secret is missing", async () => {
    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {},
      webhookSourceSecrets: {},
      headers: {
        "x-hub-signature-256": "sha256=invalid",
      },
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-body",
      message: "GitHub connection secrets are missing webhookSecret.",
    });
  });

  it("fails verification when signature header is missing", async () => {
    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {
        webhookSecret: "whsec_123",
      },
      webhookSourceSecrets: {},
      headers: {},
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-headers",
      message: "GitHub webhook is missing x-hub-signature-256 header.",
    });
  });

  it("resolves issue_comment created events into webhook events", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery_123",
      },
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        externalEventId: "delivery_123",
        externalDeliveryId: "delivery_123",
        providerEventType: "issue_comment",
        eventType: "github.issue_comment.created",
        occurredAt: IssueCommentCreatedPayload.comment.created_at,
        sourceOrderKey: `${IssueCommentCreatedPayload.comment.created_at}#${IssueCommentCreatedPayload.comment.id.toString().padStart(20, "0")}`,
      },
    });
    if (resolved.kind !== "event") {
      throw new Error("Expected GitHub webhook request resolution to produce an event.");
    }
    expect(resolved.event.payload).toEqual(IssueCommentCreatedPayload);
  });

  it("derives source order keys for every supported GitHub trigger event", async () => {
    expect(
      sortedStrings(SupportedGitHubOrderingCases.map((testCase) => testCase.eventType)),
    ).toEqual(sortedStrings(GitHubSupportedWebhookEvents.map((event) => event.eventType)));

    for (const testCase of SupportedGitHubOrderingCases) {
      const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": testCase.providerEventType,
          "x-github-delivery": testCase.deliveryId,
        },
        rawBody: encodePayload(testCase.payload),
      });

      expect(resolved).toMatchObject({
        kind: "event",
        event: {
          externalEventId: testCase.deliveryId,
          externalDeliveryId: testCase.deliveryId,
          providerEventType: testCase.providerEventType,
          eventType: testCase.eventType,
          occurredAt: testCase.expectedOccurredAt,
          sourceOrderKey: `${testCase.expectedOccurredAt}#${testCase.expectedOrderingIdentifier}`,
        },
      });
    }
  });

  it("derives pull request review request source order keys for requested teams", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery_pull_request_team_review_requested",
      },
      rawBody: encodePayload(PullRequestTeamReviewRequestedPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        externalEventId: "delivery_pull_request_team_review_requested",
        externalDeliveryId: "delivery_pull_request_team_review_requested",
        providerEventType: "pull_request",
        eventType: "github.pull_request.review_requested",
        occurredAt: "2026-04-02T17:49:43Z",
        sourceOrderKey: "2026-04-02T17:49:43Z#00000000000000002107.00000000000000003201.1",
      },
    });
  });

  it("rejects pull request review request ordering without a requested actor id", () => {
    expect(() =>
      GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery_pull_request_review_requested_without_actor",
        },
        rawBody: encodePayload(PullRequestReviewRequestedWithoutActorPayload),
      }),
    ).toThrow(
      "GitHub webhook event 'github.pull_request.review_requested' is missing requested reviewer or requested team id.",
    );

    expect(() =>
      GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery_pull_request_review_requested_without_actor_id",
        },
        rawBody: encodePayload(PullRequestReviewRequestedWithoutActorIdPayload),
      }),
    ).toThrow(
      "GitHub webhook event 'github.pull_request.review_requested' is missing requested reviewer or requested team id.",
    );
  });

  it("rejects pull request review request ordering with both requested actor ids", () => {
    expect(() =>
      GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery_pull_request_review_requested_with_two_actors",
        },
        rawBody: encodePayload(PullRequestReviewRequestedWithReviewerAndTeamPayload),
      }),
    ).toThrow(
      "GitHub webhook event 'github.pull_request.review_requested' must include exactly one requested reviewer or requested team id.",
    );
  });

  it("resolves matching connection by installation id", async () => {
    const result = GitHubWebhookHandler.resolveConnection({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      candidates: [createConnection()],
    });

    expect(result).toEqual({
      ok: true,
      connectionId: "icn_123",
    });
  });

  it("returns not-found when no connection matches installation id", async () => {
    const result = GitHubWebhookHandler.resolveConnection({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      candidates: [],
    });

    expect(result).toEqual({
      ok: false,
      code: "connection-not-found",
      message: `No active connection found for GitHub installation '${IssueCommentCreatedPayload.installation.id.toString()}'.`,
    });
  });

  it("returns invalid-connection when the path-routed connection installation mismatches the payload", async () => {
    const result = GitHubWebhookHandler.resolveConnection({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      candidates: [
        {
          id: "icn_other",
          status: "active",
          externalSubjectId: "999999",
          config: {},
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid-connection",
      message: `GitHub webhook installation '${IssueCommentCreatedPayload.installation.id.toString()}' does not match connection 'icn_other'.`,
    });
  });

  it("returns ambiguous when multiple connections match installation id", async () => {
    const installationId = IssueCommentCreatedPayload.installation.id.toString();
    const result = GitHubWebhookHandler.resolveConnection({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      candidates: [
        {
          id: "icn_1",
          status: "active",
          externalSubjectId: installationId,
          config: {},
        },
        {
          id: "icn_2",
          status: "active",
          externalSubjectId: installationId,
          config: {},
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      code: "connection-ambiguous",
      message: `Multiple active connections found for GitHub installation '${installationId}'.`,
    });
  });

  it("uses canonical provider event type for pull_request_review_comment", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "pull_request_review_comment",
        "x-github-delivery": "delivery_456",
      },
      rawBody: encodePayload(PullRequestReviewCommentCreatedPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        eventType: "github.pull_request_review_comment.created",
      },
    });
  });

  it("returns derived event type for unsupported official GitHub events", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery_789",
      },
      rawBody: encodePayload(PullRequestOpenedPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        eventType: "github.pull_request.opened",
      },
    });
  });

  it("resolves issues opened events using the canonical issues event name", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "issues",
        "x-github-delivery": "delivery_issues_opened",
      },
      rawBody: encodePayload(IssuesOpenedPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        eventType: "github.issues.opened",
      },
    });
  });

  it("resolves push events using the pushed action name", async () => {
    const resolved = await GitHubWebhookHandler.resolveWebhookRequest({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery_push",
      },
      rawBody: encodePayload(PushPayload),
    });

    expect(resolved).toMatchObject({
      kind: "event",
      event: {
        eventType: "github.push.pushed",
      },
    });
  });

  it("fails when x-github-delivery header is missing", () => {
    expect(() =>
      GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "issue_comment",
        },
        rawBody: encodePayload(IssueCommentCreatedPayload),
      }),
    ).toThrow("GitHub webhook is missing x-github-delivery header.");
  });

  it("fails when installation id is missing from payload", () => {
    const payloadWithoutInstallation = withoutInstallation(IssueCommentCreatedPayload);

    expect(() =>
      GitHubWebhookHandler.resolveWebhookRequest({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "issue_comment",
          "x-github-delivery": "delivery_111",
        },
        rawBody: encodePayload(payloadWithoutInstallation),
      }),
    ).toThrow("GitHub webhook payload is missing installation context.");
  });
});
