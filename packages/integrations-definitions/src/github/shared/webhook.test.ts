import type { IntegrationConnection } from "@mistle/integrations-core";
import GitHubWebhookDefinitions from "@octokit/webhooks-examples/api.github.com/index.json" with { type: "json" };
import { sign } from "@octokit/webhooks-methods";
import type {
  IssueCommentCreatedEvent,
  PullRequestOpenedEvent,
  PullRequestReviewCommentCreatedEvent,
  WebhookEventName,
} from "@octokit/webhooks-types";
import { describe, expect, it } from "vitest";

import { GitHubWebhookHandler } from "./webhook.js";

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

const IssueCommentEventName: WebhookEventName = "issue_comment";
const PullRequestReviewCommentEventName: WebhookEventName = "pull_request_review_comment";
const PullRequestEventName: WebhookEventName = "pull_request";

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
    secrets: {
      webhookSecret: "whsec_123",
    },
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

function withoutInstallation<TPayload extends InstallationContext>(
  payload: TPayload,
): Omit<TPayload, "installation"> {
  const { installation: _installation, ...rest } = payload;
  return rest;
}

const IssueCommentCreatedPayload: IssueCommentCreatedEvent & InstallationContext =
  resolveIssueCommentCreatedPayload();

const PullRequestReviewCommentCreatedPayload: PullRequestReviewCommentCreatedEvent &
  InstallationContext = resolvePullRequestReviewCommentCreatedPayload();

const PullRequestOpenedPayload: PullRequestOpenedEvent & InstallationContext =
  resolvePullRequestOpenedPayload();

describe("GitHubWebhookHandler", () => {
  it("verifies webhook signature with webhookSecret", async () => {
    const payloadString = JSON.stringify(IssueCommentCreatedPayload);
    const signature = await sign("whsec_123", payloadString);

    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {},
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
      target: {
        ...createGitHubCloudTargetConfig(),
        secrets: {},
      },
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {},
      headers: {
        "x-hub-signature-256": "sha256=invalid",
      },
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-body",
      message: "GitHub target secrets are missing webhook_secret.",
    });
  });

  it("fails verification when signature header is missing", async () => {
    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      event: createParsedEvent(),
      connection: createConnection(),
      connectionSecrets: {},
      headers: {},
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-headers",
      message: "GitHub webhook is missing x-hub-signature-256 header.",
    });
  });

  it("parses issue_comment created events", async () => {
    const parsed = await GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery_123",
      },
      rawBody: encodePayload(IssueCommentCreatedPayload),
    });

    expect(parsed).toMatchObject({
      externalEventId: "delivery_123",
      externalDeliveryId: "delivery_123",
      providerEventType: "issue_comment",
      eventType: "github.issue_comment.created",
    });
    expect(parsed.payload).toEqual(IssueCommentCreatedPayload);
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
      code: "connection-not-found",
      message: `No active connection found for GitHub installation '${IssueCommentCreatedPayload.installation.id.toString()}'.`,
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
    const parsed = await GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "pull_request_review_comment",
        "x-github-delivery": "delivery_456",
      },
      rawBody: encodePayload(PullRequestReviewCommentCreatedPayload),
    });

    expect(parsed.eventType).toBe("github.pull_request_review_comment.created");
  });

  it("returns derived event type for unsupported official GitHub events", async () => {
    const parsed = await GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: createGitHubCloudTargetConfig(),
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery_789",
      },
      rawBody: encodePayload(PullRequestOpenedPayload),
    });

    expect(parsed.eventType).toBe("github.pull_request.opened");
  });

  it("fails when x-github-delivery header is missing", () => {
    expect(() =>
      GitHubWebhookHandler.parse({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "issue_comment",
        },
        rawBody: encodePayload(IssueCommentCreatedPayload),
      }),
    ).toThrowError("GitHub webhook is missing x-github-delivery header.");
  });

  it("fails when installation id is missing from payload", () => {
    const payloadWithoutInstallation = withoutInstallation(IssueCommentCreatedPayload);

    expect(() =>
      GitHubWebhookHandler.parse({
        targetKey: "github_cloud",
        target: createGitHubCloudTargetConfig(),
        headers: {
          "x-github-event": "issue_comment",
          "x-github-delivery": "delivery_111",
        },
        rawBody: encodePayload(payloadWithoutInstallation),
      }),
    ).toThrowError("GitHub webhook payload is missing installation context.");
  });
});
