import { describe, expect, it } from "vitest";

import type { IntegrationWebhookEventDefinition } from "../types/index.js";
import {
  WebhookTriggerTemplateKinds,
  validateWebhookTriggerTemplates,
} from "./template-references.js";

const IssueCommentEvent: IntegrationWebhookEventDefinition = {
  eventType: "github.issue_comment.created",
  providerEventType: "issue_comment",
  displayName: "Issue comment created",
  payloadReferences: [
    {
      path: ["repository", "full_name"],
      description: "Repository owner and name",
    },
    {
      path: ["issue", "number"],
      description: "Issue number",
    },
    {
      path: ["comment", "body"],
      description: "Comment text",
    },
  ],
};

const PullRequestEvent: IntegrationWebhookEventDefinition = {
  eventType: "github.pull_request.opened",
  providerEventType: "pull_request",
  displayName: "Pull request opened",
  payloadReferences: [
    {
      path: ["repository", "full_name"],
      description: "Repository owner and name",
    },
    {
      path: ["pull_request", "number"],
      description: "Pull request number",
    },
    {
      path: ["pull_request", "body"],
      description: "Pull request body",
    },
  ],
};

describe("webhook trigger template reference validation", () => {
  it("accepts shared fields, selected payload references, documented parents, and raw payload in user messages", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: [
            "Event: {{webhookEvent.eventType}}",
            "Payload: {{payload}}",
            "{% if payload.pull_request %}PR {{payload.pull_request.number}}{% endif %}",
            'Comment: {{payload.comment.body | default: ""}}',
          ].join("\n"),
        },
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{{payload.repository.full_name}}",
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects unknown roots, unknown children, unsupported tags, and dynamic references", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            "{{webhook.eventypepe}} {{payload.pull_request.title}} {% if payload.pull_request %}PR{% endif %} {% assign x = payload.comment.body %}",
        },
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{{payload.issue[payload.comment.body]}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request}}'.",
      },
      {
        field: "inputTemplate",
        message: "Liquid tag 'assign' is not supported in trigger user message templates.",
      },
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{webhook.eventypepe}}'.",
      },
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.title}}'.",
      },
      {
        field: "conversationKeyTemplate",
        message: "Dynamic template references are not supported.",
      },
    ]);
  });

  it("rejects plain key template payload references that are not available on every selected event", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "conversationKeyTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("accepts event-type conditional key templates for alternate selected event payload shapes", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: [
            "{{payload.repository.full_name}}:pull-request:",
            '{% if webhookEvent.eventType == "github.pull_request.opened" %}',
            "{{payload.pull_request.number}}",
            "{% else %}",
            "{{payload.issue.number}}",
            "{% endif %}",
          ].join(""),
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("accepts whitespace-trimmed event-type key conditionals", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: [
            "{{payload.repository.full_name}}:pull-request:",
            '{%- if webhookEvent.eventType == "github.pull_request.opened" -%}',
            "{{payload.pull_request.number}}",
            "{%- else -%}",
            "{{payload.issue.number}}",
            "{%- endif -%}",
          ].join(""),
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects payload truthiness conditions in key templates", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{% if payload.pull_request %}{{payload.pull_request.number}}{% endif %}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "conversationKeyTemplate",
        message:
          'Only webhookEvent.eventType equality conditions are supported in key templates, for example {% if webhookEvent.eventType == "provider.event" %}.',
      },
    ]);
  });

  it("rejects conditional key references unavailable for events reaching the branch", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template:
            '{% if webhookEvent.eventType == "github.issue_comment.created" %}{{payload.pull_request.number}}{% endif %}',
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "conversationKeyTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });
});
