import { Liquid, Value, type Template } from "liquidjs";

import type { IntegrationWebhookEventDefinition } from "../types/index.js";

export type WebhookTriggerTemplateKind = "input" | "key";

export const WebhookTriggerTemplateKinds: {
  readonly INPUT: WebhookTriggerTemplateKind;
  readonly KEY: WebhookTriggerTemplateKind;
} = {
  INPUT: "input",
  KEY: "key",
};

export type WebhookTriggerTemplateFieldName =
  | "inputTemplate"
  | "conversationKeyTemplate"
  | "idempotencyKeyTemplate";

export type WebhookTriggerTemplateValidationIssue = {
  field: WebhookTriggerTemplateFieldName;
  message: string;
};

export type WebhookTriggerTemplateValidationResult = {
  issues: readonly WebhookTriggerTemplateValidationIssue[];
};

export type WebhookTriggerTemplateInput = {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
};

const SharedAllowedReferencePaths = new Set([
  "payload",
  "webhookEvent.eventType",
  "webhookEvent.id",
  "webhookEvent.providerEventType",
  "webhookEvent.externalEventId",
  "webhookEvent.externalDeliveryId",
  "triggerRun.id",
  "triggerRun.triggerId",
  "triggerRun.triggerTargetId",
]);

const LiquidTemplateEngine = new Liquid({
  lenientIf: true,
  strictFilters: true,
  strictVariables: true,
});

const ConditionalTemplateAllowedTagNames = new Set(["if", "unless"]);
const KeyTemplateAllowedTagNames = new Set(["if"]);
const NonReferenceConditionWords = new Set([
  "and",
  "blank",
  "contains",
  "empty",
  "false",
  "nil",
  "not",
  "null",
  "or",
  "true",
]);

type SelectedEventReferencePaths = {
  eventReferences: readonly EventReferencePaths[];
  eventTypes: readonly string[];
};

type EventReferencePaths = {
  allowed: ReadonlySet<string>;
  documentedPayloadReferences: ReadonlySet<string>;
};

export function validateWebhookTriggerTemplates(input: {
  templates: readonly WebhookTriggerTemplateInput[];
  selectedEvents: readonly IntegrationWebhookEventDefinition[];
}): WebhookTriggerTemplateValidationResult {
  const selectedEventReferences = buildSelectedEventReferencePaths(input.selectedEvents);
  const issues = input.templates.flatMap((templateInput) =>
    validateTemplate({
      ...templateInput,
      selectedEventReferences,
    }),
  );

  return { issues };
}

export function assertWebhookTriggerTemplatesValid(input: {
  templates: readonly WebhookTriggerTemplateInput[];
  selectedEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const result = validateWebhookTriggerTemplates(input);
  if (result.issues.length > 0) {
    throw new WebhookTriggerTemplateValidationError(result.issues);
  }
}

export class WebhookTriggerTemplateValidationError extends Error {
  readonly issues: readonly WebhookTriggerTemplateValidationIssue[];

  constructor(issues: readonly WebhookTriggerTemplateValidationIssue[]) {
    super(formatWebhookTriggerTemplateValidationIssues(issues));
    this.name = "WebhookTriggerTemplateValidationError";
    this.issues = issues;
  }
}

export function formatWebhookTriggerTemplateValidationIssues(
  issues: readonly WebhookTriggerTemplateValidationIssue[],
): string {
  return issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
}

function validateTemplate(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const templates = parseLiquidTemplates({
    field: input.field,
    template: input.template,
    issues,
  });
  if (templates === null) {
    return issues;
  }

  const containsTags = validateTemplateTags({
    field: input.field,
    kind: input.kind,
    templates,
    selectedEventReferences: input.selectedEventReferences,
    issues,
  });

  if (input.kind === WebhookTriggerTemplateKinds.INPUT && containsTags) {
    issues.push(
      ...validateConditionalInputTemplateReferences({
        field: input.field,
        templates,
        selectedEventReferences: input.selectedEventReferences,
      }),
    );
    return issues;
  }

  if (input.kind === WebhookTriggerTemplateKinds.KEY && containsTags) {
    issues.push(
      ...validateConditionalKeyTemplateReferences({
        field: input.field,
        templates,
        selectedEventReferences: input.selectedEventReferences,
      }),
    );
    return issues;
  }

  const outputReferences = extractReferencePathsFromTemplates(templates);
  if (outputReferences === null) {
    issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return issues;
  }

  for (const referencePath of outputReferences) {
    validateReferencePathForReachableEvents({
      field: input.field,
      referencePath,
      reachableEventIndexes: input.selectedEventReferences.eventReferences.map(
        (_referenceSet, index) => index,
      ),
      selectedEventReferences: input.selectedEventReferences,
      issues,
    });
  }

  return issues;
}

function parseLiquidTemplates(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  issues: WebhookTriggerTemplateValidationIssue[];
}): readonly Template[] | null {
  try {
    return LiquidTemplateEngine.parse(input.template);
  } catch {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return null;
  }
}

function validateTemplateTags(input: {
  field: WebhookTriggerTemplateFieldName;
  kind: WebhookTriggerTemplateKind;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): boolean {
  let containsTags = false;

  for (const template of input.templates) {
    const tagName = readLiquidTagName(template);
    if (tagName !== null) {
      containsTags = true;
      validateParsedTemplateTag({
        field: input.field,
        kind: input.kind,
        tagName,
        template,
        selectedEventReferences: input.selectedEventReferences,
        issues: input.issues,
      });
    }

    for (const branch of readConditionalBranches(template)) {
      if (input.kind === WebhookTriggerTemplateKinds.INPUT) {
        validateInputTemplateConditionReferences({
          field: input.field,
          condition: branch.condition,
          selectedEventReferences: input.selectedEventReferences,
          issues: input.issues,
        });
      }

      containsTags =
        validateTemplateTags({
          ...input,
          templates: branch.templates,
        }) || containsTags;
    }

    const elseTemplates = readConditionalElseTemplates(template);
    containsTags =
      validateTemplateTags({
        ...input,
        templates: elseTemplates,
      }) || containsTags;
  }

  return containsTags;
}

function validateParsedTemplateTag(input: {
  field: WebhookTriggerTemplateFieldName;
  kind: WebhookTriggerTemplateKind;
  tagName: string;
  template: Template;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const allowedTagNames =
    input.kind === WebhookTriggerTemplateKinds.KEY
      ? KeyTemplateAllowedTagNames
      : ConditionalTemplateAllowedTagNames;
  if (!allowedTagNames.has(input.tagName)) {
    input.issues.push({
      field: input.field,
      message:
        input.kind === WebhookTriggerTemplateKinds.KEY
          ? `Liquid tag '${input.tagName}' is not supported in key templates.`
          : `Liquid tag '${input.tagName}' is not supported in trigger user message templates.`,
    });
    return;
  }

  if (
    input.kind === WebhookTriggerTemplateKinds.KEY &&
    readConditionalBranches(input.template).length > 1
  ) {
    input.issues.push({
      field: input.field,
      message: "Liquid tag 'elsif' is not supported in key templates.",
    });
  }
}

function validateInputTemplateConditionReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  condition: Value;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const referencePaths = extractReferencePathsFromLiquidValue(input.condition);
  if (referencePaths === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  for (const referencePath of referencePaths) {
    if (!isReferencePathAllowedByAnySelectedEvent(input.selectedEventReferences, referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${referencePath}}}'.`,
      });
    }
  }
}

function validateConditionalInputTemplateReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const allEventIndexes = input.selectedEventReferences.eventReferences.map(
    (_referenceSet, index) => index,
  );

  validateInputTemplateReferencesForReachableEvents({
    ...input,
    issues,
    reachableEventIndexes: allEventIndexes,
  });

  return issues;
}

function validateInputTemplateReferencesForReachableEvents(input: {
  field: WebhookTriggerTemplateFieldName;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  for (const template of input.templates) {
    const tagName = readLiquidTagName(template);
    if (tagName === null) {
      validateTemplateReferencePathsForReachableEvents({
        ...input,
        templates: [template],
      });
      continue;
    }

    if (tagName === "if" || tagName === "unless") {
      validateConditionalInputTagReferences({
        ...input,
        template,
        tagName,
      });
    }
  }
}

function validateConditionalInputTagReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  template: Template;
  tagName: string;
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  let consumedBranchReachableEventIndexes: readonly number[] = [];
  let unmodeledBranchFallbackReachableEventIndexes: readonly number[] | null = null;

  const branches = readConditionalBranches(input.template);
  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branch = branches[branchIndex];
    if (branch === undefined) {
      throw new Error(`Missing conditional branch at index ${branchIndex}.`);
    }

    const elseReachableEventIndexes: readonly number[] =
      unmodeledBranchFallbackReachableEventIndexes ??
      subtractEventIndexes(input.reachableEventIndexes, consumedBranchReachableEventIndexes);
    const matchingEventIndexes = filterReachableEventsByModeledInputCondition({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: elseReachableEventIndexes,
      condition: branch.condition,
    });
    const isInvertedUnlessBranch = input.tagName === "unless" && branchIndex === 0;
    const branchReachableEventIndexes =
      matchingEventIndexes === null
        ? elseReachableEventIndexes
        : isInvertedUnlessBranch
          ? subtractEventIndexes(elseReachableEventIndexes, matchingEventIndexes)
          : matchingEventIndexes;

    validateInputTemplateReferencesForReachableEvents({
      field: input.field,
      templates: branch.templates,
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: branchReachableEventIndexes,
      issues: input.issues,
    });

    if (matchingEventIndexes === null) {
      unmodeledBranchFallbackReachableEventIndexes ??= elseReachableEventIndexes;
    } else if (unmodeledBranchFallbackReachableEventIndexes === null) {
      consumedBranchReachableEventIndexes = unionEventIndexes(
        consumedBranchReachableEventIndexes,
        branchReachableEventIndexes,
      );
    }
  }

  validateInputTemplateReferencesForReachableEvents({
    field: input.field,
    templates: readConditionalElseTemplates(input.template),
    selectedEventReferences: input.selectedEventReferences,
    reachableEventIndexes:
      unmodeledBranchFallbackReachableEventIndexes ??
      subtractEventIndexes(input.reachableEventIndexes, consumedBranchReachableEventIndexes),
    issues: input.issues,
  });
}

function filterReachableEventsByModeledInputCondition(input: {
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  condition: Value;
}): readonly number[] | null {
  const expression = extractSimpleExpressionFromLiquidValue(input.condition);
  if (expression === null) {
    return null;
  }

  const eventType = extractWebhookEventTypeEqualityValue(expression);
  if (eventType !== null) {
    return filterReachableEventsByEventType({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: input.reachableEventIndexes,
      eventType,
    });
  }

  const referencePath = extractSimplePositiveConditionReferencePath(expression);
  if (referencePath === null) {
    return null;
  }

  return filterReachableEventsByReferencePaths({
    selectedEventReferences: input.selectedEventReferences,
    reachableEventIndexes: input.reachableEventIndexes,
    referencePaths: [referencePath],
  });
}

function validateConditionalKeyTemplateReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const allEventIndexes = input.selectedEventReferences.eventReferences.map(
    (_referenceSet, index) => index,
  );

  validateKeyTemplateReferencesForReachableEvents({
    ...input,
    issues,
    reachableEventIndexes: allEventIndexes,
  });

  return issues;
}

function validateKeyTemplateReferencesForReachableEvents(input: {
  field: WebhookTriggerTemplateFieldName;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  for (const template of input.templates) {
    const tagName = readLiquidTagName(template);
    if (tagName === null) {
      validateTemplateReferencePathsForReachableEvents({
        ...input,
        templates: [template],
      });
      continue;
    }

    if (tagName !== "if") {
      continue;
    }

    let consumedBranchReachableEventIndexes: readonly number[] = [];
    for (const branch of readConditionalBranches(template)) {
      const branchReachableEventIndexes = filterReachableEventsByModeledKeyCondition({
        field: input.field,
        selectedEventReferences: input.selectedEventReferences,
        reachableEventIndexes: input.reachableEventIndexes,
        condition: branch.condition,
        issues: input.issues,
      });
      consumedBranchReachableEventIndexes = unionEventIndexes(
        consumedBranchReachableEventIndexes,
        branchReachableEventIndexes,
      );
      validateKeyTemplateReferencesForReachableEvents({
        field: input.field,
        templates: branch.templates,
        selectedEventReferences: input.selectedEventReferences,
        reachableEventIndexes: branchReachableEventIndexes,
        issues: input.issues,
      });
    }

    validateKeyTemplateReferencesForReachableEvents({
      field: input.field,
      templates: readConditionalElseTemplates(template),
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: subtractEventIndexes(
        input.reachableEventIndexes,
        consumedBranchReachableEventIndexes,
      ),
      issues: input.issues,
    });
  }
}

function filterReachableEventsByModeledKeyCondition(input: {
  field: WebhookTriggerTemplateFieldName;
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  condition: Value;
  issues: WebhookTriggerTemplateValidationIssue[];
}): readonly number[] {
  const expression = extractSimpleExpressionFromLiquidValue(input.condition);
  if (expression === null) {
    input.issues.push({
      field: input.field,
      message:
        'Only webhookEvent.eventType equality or simple payload presence conditions are supported in key templates, for example {% if webhookEvent.eventType == "provider.event" %} or {% if payload.resource %}.',
    });
    return [];
  }

  const eventType = extractWebhookEventTypeEqualityValue(expression);
  if (eventType !== null) {
    return filterReachableEventsByEventType({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: input.reachableEventIndexes,
      eventType,
    });
  }

  const referencePath = extractSimplePositiveConditionReferencePath(expression);
  if (referencePath !== null) {
    if (!isReferencePathAllowedByAnySelectedEvent(input.selectedEventReferences, referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${referencePath}}}'.`,
      });
      return [];
    }

    return filterReachableEventsByReferencePaths({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: input.reachableEventIndexes,
      referencePaths: [referencePath],
    });
  }

  input.issues.push({
    field: input.field,
    message:
      'Only webhookEvent.eventType equality or simple payload presence conditions are supported in key templates, for example {% if webhookEvent.eventType == "provider.event" %} or {% if payload.resource %}.',
  });
  return [];
}

function validateTemplateReferencePathsForReachableEvents(input: {
  field: WebhookTriggerTemplateFieldName;
  templates: readonly Template[];
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const referencePaths = extractReferencePathsFromTemplates(input.templates);
  if (referencePaths === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  for (const referencePath of referencePaths) {
    validateReferencePathForReachableEvents({
      field: input.field,
      referencePath,
      reachableEventIndexes: input.reachableEventIndexes,
      selectedEventReferences: input.selectedEventReferences,
      issues: input.issues,
    });
  }
}

function extractReferencePathsFromTemplates(
  templates: readonly Template[],
): readonly string[] | null {
  const referencePaths: string[] = [];
  for (const segments of LiquidTemplateEngine.globalVariableSegmentsSync([...templates], {
    partials: false,
  })) {
    const referencePath = readSimpleReferencePathFromSegments(segments);
    if (referencePath === null) {
      return null;
    }

    referencePaths.push(referencePath);
  }

  return referencePaths;
}

function extractReferencePathsFromLiquidValue(value: Value): readonly string[] | null {
  const referencePaths: string[] = [];
  for (const token of value.initial.postfix) {
    if (!collectReferencePathsFromToken(token, referencePaths)) {
      return null;
    }
  }

  for (const filter of value.filters) {
    for (const filterArgument of filter.args) {
      if (!collectReferencePathsFromFilterArgument(filterArgument, referencePaths)) {
        return null;
      }
    }
  }

  return referencePaths;
}

function collectReferencePathsFromFilterArgument(
  filterArgument: unknown,
  referencePaths: string[],
): boolean {
  if (Array.isArray(filterArgument)) {
    const value = filterArgument[1];
    return value === undefined || collectReferencePathsFromToken(value, referencePaths);
  }

  return collectReferencePathsFromToken(filterArgument, referencePaths);
}

function collectReferencePathsFromToken(token: unknown, referencePaths: string[]): boolean {
  const propertyAccessReferencePath = readSimplePropertyAccessReferencePath(token);
  if (propertyAccessReferencePath === DynamicReferencePath) {
    return false;
  }

  if (propertyAccessReferencePath !== null) {
    referencePaths.push(propertyAccessReferencePath);
    return true;
  }

  const leftHandSide = readUnknownProperty(token, "lhs");
  if (leftHandSide !== undefined && !collectReferencePathsFromToken(leftHandSide, referencePaths)) {
    return false;
  }

  const rightHandSide = readUnknownProperty(token, "rhs");
  return (
    rightHandSide === undefined || collectReferencePathsFromToken(rightHandSide, referencePaths)
  );
}

const DynamicReferencePath = Symbol("dynamic reference path");

function readSimplePropertyAccessReferencePath(
  token: unknown,
): string | typeof DynamicReferencePath | null {
  if (readConstructorName(token) !== "PropertyAccessToken") {
    return null;
  }

  if (readUnknownProperty(token, "variable") !== undefined) {
    return DynamicReferencePath;
  }

  const props = readUnknownProperty(token, "props");
  if (!Array.isArray(props)) {
    return DynamicReferencePath;
  }

  const segments: string[] = [];
  for (const prop of props) {
    const constructorName = readConstructorName(prop);
    if (constructorName !== "IdentifierToken" && constructorName !== "NumberToken") {
      return DynamicReferencePath;
    }

    const content = readUnknownProperty(prop, "content");
    const segment = normalizeReferencePathSegment(content);
    if (segment === null) {
      return DynamicReferencePath;
    }

    segments.push(segment);
  }

  const referencePath = segments.join(".");
  return isSimpleReferencePath(referencePath) ? referencePath : DynamicReferencePath;
}

function readSimpleReferencePathFromSegments(segments: readonly unknown[]): string | null {
  const referencePathSegments: string[] = [];
  for (const segment of segments) {
    const normalizedSegment = normalizeReferencePathSegment(segment);
    if (normalizedSegment === null) {
      return null;
    }

    referencePathSegments.push(normalizedSegment);
  }

  const referencePath = referencePathSegments.join(".");
  return isSimpleReferencePath(referencePath) ? referencePath : null;
}

type ConditionalBranch = {
  condition: Value;
  templates: readonly Template[];
};

function readConditionalBranches(template: Template): readonly ConditionalBranch[] {
  const branches = readUnknownProperty(template, "branches");
  if (!Array.isArray(branches)) {
    return [];
  }

  const conditionalBranches: ConditionalBranch[] = [];
  for (const branch of branches) {
    const condition = readUnknownProperty(branch, "value");
    const templates = readLiquidTemplateArray(readUnknownProperty(branch, "templates"));
    if (condition instanceof Value && templates !== null) {
      conditionalBranches.push({
        condition,
        templates,
      });
    }
  }

  return conditionalBranches;
}

function readConditionalElseTemplates(template: Template): readonly Template[] {
  return readLiquidTemplateArray(readUnknownProperty(template, "elseTemplates")) ?? [];
}

function readLiquidTemplateArray(value: unknown): readonly Template[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const templates: Template[] = [];
  for (const item of value) {
    if (!isLiquidTemplate(item)) {
      return null;
    }

    templates.push(item);
  }

  return templates;
}

function isLiquidTemplate(value: unknown): value is Template {
  return isRecord(value) && readUnknownProperty(value, "token") !== undefined;
}

function readLiquidTagName(template: Template): string | null {
  const name = readUnknownProperty(template.token, "name");
  return typeof name === "string" ? name : null;
}

function extractSimpleExpressionFromLiquidValue(value: Value): string | null {
  if (value.filters.length > 0 || value.initial.postfix.length === 0) {
    return null;
  }

  let input: string | null = null;
  let begin: number | null = null;
  let end: number | null = null;

  for (const token of value.initial.postfix) {
    if (input === null) {
      input = token.input;
    } else if (input !== token.input) {
      return null;
    }

    begin = begin === null ? token.begin : Math.min(begin, token.begin);
    end = end === null ? token.end : Math.max(end, token.end);
  }

  if (input === null || begin === null || end === null) {
    return null;
  }

  return input.slice(begin, end);
}

function extractSimplePositiveConditionReferencePath(expression: string): string | null {
  const trimmedExpression = expression.trim();
  if (!isSimpleReferencePath(trimmedExpression)) {
    return null;
  }

  return NonReferenceConditionWords.has(trimmedExpression) ? null : trimmedExpression;
}

function extractWebhookEventTypeEqualityValue(expression: string): string | null {
  const leftHandSide = "webhookEvent.eventType";
  const trimmedExpression = expression.trim();
  if (!trimmedExpression.startsWith(leftHandSide)) {
    return null;
  }

  let cursor = leftHandSide.length;
  cursor = skipWhitespace(trimmedExpression, cursor);
  if (!trimmedExpression.startsWith("==", cursor)) {
    return null;
  }

  cursor = skipWhitespace(trimmedExpression, cursor + 2);
  if (trimmedExpression[cursor] !== '"') {
    return null;
  }

  const eventTypeStart = cursor + 1;
  const eventTypeEnd = trimmedExpression.indexOf('"', eventTypeStart);
  if (eventTypeEnd === -1) {
    return null;
  }

  const trailingCursor = skipWhitespace(trimmedExpression, eventTypeEnd + 1);
  if (trailingCursor !== trimmedExpression.length) {
    return null;
  }

  return trimmedExpression.slice(eventTypeStart, eventTypeEnd);
}

function filterReachableEventsByEventType(input: {
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  eventType: string;
}): readonly number[] {
  return input.reachableEventIndexes.filter((eventIndex) => {
    const eventType = input.selectedEventReferences.eventTypes[eventIndex];
    if (eventType === undefined) {
      throw new Error(`Missing selected event type for index ${eventIndex}.`);
    }

    return eventType === input.eventType;
  });
}

function filterReachableEventsByReferencePaths(input: {
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  referencePaths: readonly string[];
}): readonly number[] {
  return input.reachableEventIndexes.filter((eventIndex) => {
    const eventReferences = input.selectedEventReferences.eventReferences[eventIndex];
    if (eventReferences === undefined) {
      throw new Error(`Missing selected event reference set for index ${eventIndex}.`);
    }

    return input.referencePaths.every((referencePath) =>
      isReferencePathAllowedByEvent(eventReferences, referencePath),
    );
  });
}

function subtractEventIndexes(
  sourceEventIndexes: readonly number[],
  removedEventIndexes: readonly number[],
): readonly number[] {
  return sourceEventIndexes.filter((eventIndex) => !removedEventIndexes.includes(eventIndex));
}

function unionEventIndexes(
  leftEventIndexes: readonly number[],
  rightEventIndexes: readonly number[],
): readonly number[] {
  const union = [...leftEventIndexes];
  for (const eventIndex of rightEventIndexes) {
    if (!union.includes(eventIndex)) {
      union.push(eventIndex);
    }
  }

  return union;
}

function validateReferencePathForReachableEvents(input: {
  field: WebhookTriggerTemplateFieldName;
  referencePath: string;
  reachableEventIndexes: readonly number[];
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  if (input.selectedEventReferences.eventReferences.length === 0) {
    validateReferencePathForSelectedEventCommon(input);
    return;
  }

  for (const eventIndex of input.reachableEventIndexes) {
    const eventReferences = input.selectedEventReferences.eventReferences[eventIndex];
    if (eventReferences === undefined) {
      throw new Error(`Missing selected event reference set for index ${eventIndex}.`);
    }

    if (!isReferencePathAllowedByEvent(eventReferences, input.referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
      });
      return;
    }
  }
}

function skipWhitespace(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const char = value[cursor];
    if (char === undefined || !isWhitespace(char)) {
      return cursor;
    }

    cursor += 1;
  }

  return cursor;
}

function isSimpleReferencePath(referencePath: string): boolean {
  if (referencePath.length === 0) {
    return false;
  }

  const segments = referencePath.split(".");
  return segments.every((segment, index) =>
    index === 0 ? isReferenceRootSegment(segment) : isReferenceChildSegment(segment),
  );
}

function isReferenceRootSegment(segment: string): boolean {
  const firstChar = segment[0];
  if (firstChar === undefined || !isReferenceStartCharacter(firstChar)) {
    return false;
  }

  return everyCharacterAfterFirstMatches(segment, isReferenceChildCharacter);
}

function isReferenceChildSegment(segment: string): boolean {
  if (segment.length === 0) {
    return false;
  }

  return everyCharacterMatches(segment, isReferenceChildCharacter);
}

function normalizeReferencePathSegment(segment: unknown): string | null {
  if (typeof segment === "string") {
    return segment;
  }

  if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
    return String(segment);
  }

  return null;
}

function everyCharacterAfterFirstMatches(
  value: string,
  predicate: (char: string) => boolean,
): boolean {
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined || !predicate(char)) {
      return false;
    }
  }

  return true;
}

function everyCharacterMatches(value: string, predicate: (char: string) => boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined || !predicate(char)) {
      return false;
    }
  }

  return true;
}

function isReferenceStartCharacter(char: string): boolean {
  return isAsciiLetter(char) || char === "_";
}

function isReferenceChildCharacter(char: string): boolean {
  return isAsciiLetter(char) || isAsciiDigit(char) || char === "_";
}

function isAsciiLetter(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function isAsciiDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function validateReferencePathForSelectedEventCommon(input: {
  field: WebhookTriggerTemplateFieldName;
  referencePath: string;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  if (!SharedAllowedReferencePaths.has(input.referencePath)) {
    input.issues.push({
      field: input.field,
      message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
    });
  }
}

function readUnknownProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readConstructorName(value: unknown): string | null {
  const constructor = readUnknownProperty(value, "constructor");
  const name = readUnknownProperty(constructor, "name");
  return typeof name === "string" ? name : null;
}

function buildSelectedEventReferencePaths(
  selectedEvents: readonly IntegrationWebhookEventDefinition[],
): SelectedEventReferencePaths {
  const perEventReferences = selectedEvents.map(buildEventReferencePaths);

  return {
    eventReferences: perEventReferences,
    eventTypes: selectedEvents.map((eventDefinition) => eventDefinition.eventType),
  };
}

function buildEventReferencePaths(
  eventDefinition: IntegrationWebhookEventDefinition,
): EventReferencePaths {
  const allowed = new Set(SharedAllowedReferencePaths);
  const documentedPayloadReferences = new Set<string>();

  for (const payloadReference of eventDefinition.payloadReferences ?? []) {
    if (payloadReference.allowsDescendants === true) {
      documentedPayloadReferences.add(toPayloadReferencePath(payloadReference.path));
    }

    addPayloadReferencePath(allowed, payloadReference.path);
  }

  return { allowed, documentedPayloadReferences };
}

function addPayloadReferencePath(
  allowedReferences: Set<string>,
  payloadReferencePath: readonly string[],
): void {
  allowedReferences.add("payload");

  for (let index = 1; index <= payloadReferencePath.length; index += 1) {
    allowedReferences.add(["payload", ...payloadReferencePath.slice(0, index)].join("."));
  }
}

function toPayloadReferencePath(payloadReferencePath: readonly string[]): string {
  return ["payload", ...payloadReferencePath].join(".");
}

function isReferencePathAllowedByAnySelectedEvent(
  selectedEventReferences: SelectedEventReferencePaths,
  referencePath: string,
): boolean {
  if (selectedEventReferences.eventReferences.length === 0) {
    return SharedAllowedReferencePaths.has(referencePath);
  }

  return selectedEventReferences.eventReferences.some((eventReferences) =>
    isReferencePathAllowedByEvent(eventReferences, referencePath),
  );
}

function isReferencePathAllowedByEvent(
  eventReferences: EventReferencePaths,
  referencePath: string,
): boolean {
  if (eventReferences.allowed.has(referencePath)) {
    return true;
  }

  for (const documentedPayloadReference of eventReferences.documentedPayloadReferences) {
    if (isDescendantReferencePath(referencePath, documentedPayloadReference)) {
      return true;
    }
  }

  return false;
}

function isDescendantReferencePath(referencePath: string, ancestorReferencePath: string): boolean {
  return (
    referencePath.length > ancestorReferencePath.length &&
    referencePath.startsWith(`${ancestorReferencePath}.`)
  );
}
