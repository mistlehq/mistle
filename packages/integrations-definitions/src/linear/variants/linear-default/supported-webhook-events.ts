import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookPayloadReference,
  IntegrationWebhookTriggerProviderPermissionRequirement,
  IntegrationWebhookTriggerRequirements,
} from "@mistle/integrations-core";

import { createInvocationTokenParameter } from "../../../shared/invocation-token-parameter.js";

export const LinearWebhookPermissionRequirements = {
  WORKSPACE_ADMIN: {
    permission: "workspace-admin",
  },
} satisfies Record<string, IntegrationWebhookTriggerProviderPermissionRequirement>;

const LinearIssueConversationKeyOption = {
  id: "issue",
  label: "Issue",
  description: "Events from the same Linear issue go to the same conversation.",
  template: "{{payload.data.identifier}}",
};

const LinearCommentIssueConversationKeyOption = {
  id: "issue",
  label: "Issue",
  description: "Comments on the same Linear issue go to the same conversation.",
  template: "{{payload.data.issueId}}",
};

const LinearGenericEntityConversationKeyOption = {
  id: "entity",
  label: "Entity",
  description: "Events for the same Linear entity go to the same conversation.",
  template: "{{payload.data.id}}",
};

const LinearDataPayloadReference: IntegrationWebhookPayloadReference = {
  path: ["data"],
  description: "Linear webhook data object.",
};

const LinearIssuePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  LinearDataPayloadReference,
  {
    path: ["data", "id"],
    description: "Linear issue ID.",
  },
  {
    path: ["data", "identifier"],
    description: "Linear issue identifier.",
  },
  {
    path: ["data", "teamId"],
    description: "Linear team ID for the issue.",
  },
  {
    path: ["data", "assigneeId"],
    description: "Linear user ID assigned to the issue.",
  },
  {
    path: ["mistle", "changedFields"],
    description: "Normalized list of fields changed by an update event.",
  },
  {
    path: ["mistle", "assignment"],
    description: "Normalized assignment-change metadata for issue update events.",
  },
];

const LinearCommentPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  LinearDataPayloadReference,
  {
    path: ["data", "id"],
    description: "Linear comment ID.",
  },
  {
    path: ["data", "issueId"],
    description: "Linear issue ID associated with the comment.",
  },
  {
    path: ["data", "userId"],
    description: "Linear user ID for the comment author.",
  },
  {
    path: ["data", "body"],
    description: "Linear comment body.",
  },
];

const LinearGenericEntityPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  LinearDataPayloadReference,
  {
    path: ["data", "id"],
    description: "Linear entity ID.",
  },
  {
    path: ["mistle", "changedFields"],
    description: "Normalized list of fields changed by an update event.",
  },
];

const LinearIssueIdParameter: IntegrationWebhookEventParameterDefinition = {
  id: "issueId",
  label: "issue",
  kind: "string",
  payloadPath: ["data", "id"],
  prefix: "for",
  placeholder: "Linear issue ID",
};

const LinearIssueIdentifierParameter: IntegrationWebhookEventParameterDefinition = {
  id: "issueIdentifier",
  label: "issue",
  kind: "string",
  payloadPath: ["data", "identifier"],
  prefix: "for",
  placeholder: "ENG-123",
};

const LinearActorParameter: IntegrationWebhookEventParameterDefinition = {
  id: "actor",
  label: "actor",
  kind: "string",
  payloadPath: ["actor", "id"],
  prefix: "by",
  placeholder: "Any actor",
};

const LinearAssigneeParameter: IntegrationWebhookEventParameterDefinition = {
  id: "assignee",
  label: "assignee",
  kind: "string",
  payloadPath: ["data", "assigneeId"],
  prefix: "assigned to",
  placeholder: "Any assignee",
};

const LinearProjectParameter: IntegrationWebhookEventParameterDefinition = {
  id: "project",
  label: "project",
  kind: "string",
  payloadPath: ["data", "projectId"],
  prefix: "in",
  placeholder: "Any project",
};

const LinearTeamParameter: IntegrationWebhookEventParameterDefinition = {
  id: "team",
  label: "team",
  kind: "string",
  payloadPath: ["data", "teamId"],
  prefix: "in",
  placeholder: "Any team",
};

const LinearCommentIssueIdParameter: IntegrationWebhookEventParameterDefinition = {
  id: "issueId",
  label: "issue",
  kind: "string",
  payloadPath: ["data", "issueId"],
  prefix: "for",
  placeholder: "Linear issue ID",
};

const LinearEntityIdParameter: IntegrationWebhookEventParameterDefinition = {
  id: "entityId",
  label: "entity",
  kind: "string",
  payloadPath: ["data", "id"],
  prefix: "for",
  placeholder: "Linear entity ID",
};

function createLinearWebhookRequirements(eventType: string): IntegrationWebhookTriggerRequirements {
  return {
    anyOf: [
      {
        event: eventType,
        permissions: [LinearWebhookPermissionRequirements.WORKSPACE_ADMIN],
      },
    ],
  };
}

function createLinearWebhookEventDefinition(input: {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions: readonly {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
  parameters: readonly IntegrationWebhookEventParameterDefinition[];
}): IntegrationWebhookEventDefinition {
  return {
    eventType: input.eventType,
    providerEventType: input.providerEventType,
    displayName: input.displayName,
    category: input.category,
    requirements: createLinearWebhookRequirements(input.providerEventType),
    payloadReferences: input.payloadReferences,
    conversationKeyOptions: input.conversationKeyOptions,
    parameters: input.parameters,
  };
}

const LinearIssueParameters = [
  LinearIssueIdParameter,
  LinearIssueIdentifierParameter,
  LinearActorParameter,
  LinearAssigneeParameter,
  LinearProjectParameter,
  LinearTeamParameter,
];

const LinearCommentParameters = [
  createInvocationTokenParameter(["data", "body"]),
  LinearCommentIssueIdParameter,
  LinearActorParameter,
];

const LinearGenericEntityParameters = [LinearEntityIdParameter, LinearActorParameter];

const LinearWebhookCrudActions = [
  {
    eventSuffix: "created",
    displaySuffix: "created",
  },
  {
    eventSuffix: "updated",
    displaySuffix: "updated",
  },
  {
    eventSuffix: "removed",
    displaySuffix: "removed",
  },
];

function createLinearCrudWebhookEventDefinitions(input: {
  eventResourceName: string;
  providerEventType: string;
  displayResourceName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions: readonly {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
  parameters: readonly IntegrationWebhookEventParameterDefinition[];
}): readonly IntegrationWebhookEventDefinition[] {
  return LinearWebhookCrudActions.map((action) =>
    createLinearWebhookEventDefinition({
      eventType: `linear.${input.eventResourceName}.${action.eventSuffix}`,
      providerEventType: input.providerEventType,
      displayName: `${input.displayResourceName} ${action.displaySuffix}`,
      category: input.category,
      payloadReferences: input.payloadReferences,
      conversationKeyOptions: input.conversationKeyOptions,
      parameters: input.parameters,
    }),
  );
}

export const LinearManagedWebhookResourceTypes = Object.freeze([
  "Issue",
  "Comment",
  "IssueLabel",
  "Project",
  "Cycle",
  "Reaction",
]);

export const LinearSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] =
  Object.freeze([
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "issue",
      providerEventType: "Issue",
      displayResourceName: "Issue",
      category: "Issues",
      payloadReferences: LinearIssuePayloadReferences,
      conversationKeyOptions: [LinearIssueConversationKeyOption],
      parameters: LinearIssueParameters,
    }),
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "comment",
      providerEventType: "Comment",
      displayResourceName: "Comment",
      category: "Comments",
      payloadReferences: LinearCommentPayloadReferences,
      conversationKeyOptions: [LinearCommentIssueConversationKeyOption],
      parameters: LinearCommentParameters,
    }),
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "issue_label",
      providerEventType: "IssueLabel",
      displayResourceName: "Issue label",
      category: "Labels",
      payloadReferences: LinearGenericEntityPayloadReferences,
      conversationKeyOptions: [LinearGenericEntityConversationKeyOption],
      parameters: LinearGenericEntityParameters,
    }),
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "project",
      providerEventType: "Project",
      displayResourceName: "Project",
      category: "Projects",
      payloadReferences: LinearGenericEntityPayloadReferences,
      conversationKeyOptions: [LinearGenericEntityConversationKeyOption],
      parameters: LinearGenericEntityParameters,
    }),
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "cycle",
      providerEventType: "Cycle",
      displayResourceName: "Cycle",
      category: "Cycles",
      payloadReferences: LinearGenericEntityPayloadReferences,
      conversationKeyOptions: [LinearGenericEntityConversationKeyOption],
      parameters: LinearGenericEntityParameters,
    }),
    ...createLinearCrudWebhookEventDefinitions({
      eventResourceName: "reaction",
      providerEventType: "Reaction",
      displayResourceName: "Reaction",
      category: "Reactions",
      payloadReferences: LinearGenericEntityPayloadReferences,
      conversationKeyOptions: [LinearGenericEntityConversationKeyOption],
      parameters: LinearGenericEntityParameters,
    }),
  ]);
