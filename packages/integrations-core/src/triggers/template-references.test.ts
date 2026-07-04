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

const MessageObjectEvent: IntegrationWebhookEventDefinition = {
  eventType: "provider.message.created",
  providerEventType: "message",
  displayName: "Message created",
  payloadReferences: [
    {
      path: ["message"],
      description: "Message object",
      allowsDescendants: true,
    },
  ],
};

const IndexedMessageEvent: IntegrationWebhookEventDefinition = {
  eventType: "provider.message.received",
  providerEventType: "message_received",
  displayName: "Message received",
  payloadReferences: [
    {
      path: ["messages", "0", "chat_id"],
      description: "First message chat id",
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
            '{% if payload.comment %}Comment: {{payload.comment.body | default: ""}}{% endif %}',
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

  it("accepts descendants of documented payload object references", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [MessageObjectEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{{payload.message.chat.id}}",
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects descendants of scalar payload references", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: "{{payload.comment.body.text}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.comment.body.text}}'.",
      },
    ]);
  });

  it("accepts literal numeric array indexes in documented payload references", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IndexedMessageEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{{payload.messages[0].chat_id}}",
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects unguarded user-message payload references that are not available on every selected event", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: "Review {{payload.pull_request.number}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("accepts supported references used as output filter arguments", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            "{{payload.comment.body | default: payload.repository.full_name, allow_false: true}}",
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects unsupported references used as output filter arguments", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: "{{webhookEvent.id | truncate: 0 | append: triggerRun.some_secret_field}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{triggerRun.some_secret_field}}'.",
      },
    ]);
  });

  it("rejects selected-event-specific payload references used as output filter arguments outside a narrowed branch", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: "{{payload.repository.full_name | append: payload.pull_request.number}}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("accepts event-type conditional user-message references for alternate selected event payload shapes", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: [
            '{% if webhookEvent.eventType == "github.pull_request.opened" %}',
            "Review PR {{payload.pull_request.number}}",
            "{% elsif payload.issue %}",
            "Review issue {{payload.issue.number}}",
            "{% endif %}",
          ].join(""),
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects user-message references under compound conditions that do not prove the payload shape", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            "{% if payload.pull_request or payload.issue %}Review PR {{payload.pull_request.number}}{% endif %}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("rejects user-message references under negated conditions that can reach events missing the payload shape", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            "{% if not payload.pull_request %}Review PR {{payload.pull_request.number}}{% endif %}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("rejects else-branch references after unmodeled conditions that can reach events missing the payload shape", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            '{% if payload.pull_request.body contains "draft" %}No PR ref{% else %}Review PR {{payload.pull_request.number}}{% endif %}',
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.pull_request.number}}'.",
      },
    ]);
  });

  it("accepts modeled elsif references after unmodeled conditions when the elsif proves the payload shape", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template:
            '{% if payload.pull_request.body contains "draft" %}No PR ref{% elsif payload.issue %}Issue {{payload.issue.number}}{% endif %}',
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects elsif references under unless when the positive elsif branch reaches events missing the payload shape", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "inputTemplate",
          kind: WebhookTriggerTemplateKinds.INPUT,
          template: [
            "{% unless payload.pull_request %}",
            "Issue {{payload.issue.number}}",
            "{% elsif payload.pull_request %}",
            "Issue {{payload.issue.number}}",
            "{% endunless %}",
          ].join(""),
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "inputTemplate",
        message: "Unsupported trigger event field reference '{{payload.issue.number}}'.",
      },
    ]);
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

  it("accepts payload-presence conditional key templates for alternate selected event payload shapes", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: [
            "{{payload.repository.full_name}}:pull-request:",
            "{% if payload.pull_request %}",
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

  it("accepts whitespace-trimmed payload-presence key conditionals", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: [
            "{{payload.repository.full_name}}:pull-request:",
            "{%- if payload.pull_request -%}",
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

  it("rejects compound payload conditions in key templates", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template:
            "{% if payload.pull_request or payload.issue %}{{payload.pull_request.number}}{% endif %}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "conversationKeyTemplate",
        message:
          'Only webhookEvent.eventType equality or simple payload presence conditions are supported in key templates, for example {% if webhookEvent.eventType == "provider.event" %} or {% if payload.resource %}.',
      },
    ]);
  });

  it("rejects unsupported key-template condition references before narrowing branch reachability", () => {
    const result = validateWebhookTriggerTemplates({
      selectedEvents: [IssueCommentEvent, PullRequestEvent],
      templates: [
        {
          field: "conversationKeyTemplate",
          kind: WebhookTriggerTemplateKinds.KEY,
          template: "{% if payload.not_real %}{{payload.pull_request.number}}{% endif %}",
        },
      ],
    });

    expect(result.issues).toEqual([
      {
        field: "conversationKeyTemplate",
        message: "Unsupported trigger event field reference '{{payload.not_real}}'.",
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
