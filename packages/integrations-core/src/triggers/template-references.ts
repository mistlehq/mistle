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

const ConditionalTemplateAllowedTagNames = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
]);
const KeyTemplateAllowedTagNames = new Set(["if", "else", "endif"]);
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
  all: ReadonlySet<string>;
  common: ReadonlySet<string>;
  eventReferences: readonly ReadonlySet<string>[];
  eventTypes: readonly string[];
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
  const outputReferences: string[] = [];
  const containsTags = collectTemplateReferencesAndTagIssues({
    ...input,
    outputReferences,
    issues,
  });

  if (input.kind === WebhookTriggerTemplateKinds.INPUT && containsTags) {
    issues.push(
      ...validateConditionalInputTemplateReferences({
        field: input.field,
        template: input.template,
        selectedEventReferences: input.selectedEventReferences,
      }),
    );
    return issues;
  }

  if (input.kind === WebhookTriggerTemplateKinds.KEY && containsTags) {
    issues.push(
      ...validateConditionalKeyTemplateReferences({
        field: input.field,
        template: input.template,
        selectedEventReferences: input.selectedEventReferences,
      }),
    );
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

function forEachLiquidToken(template: string, callback: (token: string) => void): void {
  let cursor = 0;
  while (cursor < template.length) {
    const outputStart = template.indexOf("{{", cursor);
    const tagStart = template.indexOf("{%", cursor);
    const tokenStart = earliestNonNegativeIndex(outputStart, tagStart);
    if (tokenStart === null) {
      return;
    }

    const endMarker = template.startsWith("{{", tokenStart) ? "}}" : "%}";
    const tokenEnd = template.indexOf(endMarker, tokenStart + 2);
    if (tokenEnd === -1) {
      return;
    }

    callback(template.slice(tokenStart, tokenEnd + 2));
    cursor = tokenEnd + 2;
  }
}

function earliestNonNegativeIndex(left: number, right: number): number | null {
  if (left === -1) {
    return right === -1 ? null : right;
  }

  if (right === -1) {
    return left;
  }

  return Math.min(left, right);
}

function validateReferencePathForSelectedEventCommon(input: {
  field: WebhookTriggerTemplateFieldName;
  referencePath: string;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  if (!input.selectedEventReferences.common.has(input.referencePath)) {
    input.issues.push({
      field: input.field,
      message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
    });
  }
}

function collectTemplateReferencesAndTagIssues(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
  outputReferences: string[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): boolean {
  let containsTags = false;

  forEachLiquidToken(input.template, (token) => {
    if (token.startsWith("{{")) {
      collectOutputReferences({
        field: input.field,
        token,
        outputReferences: input.outputReferences,
        issues: input.issues,
      });
    } else {
      containsTags = true;
      validateTemplateTag({
        field: input.field,
        token,
        kind: input.kind,
        selectedEventReferences: input.selectedEventReferences,
        issues: input.issues,
      });
    }
  });

  return containsTags;
}

function collectOutputReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  outputReferences: string[];
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const referencePath = extractOutputReferencePath(input.token);
  if (referencePath === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  input.outputReferences.push(referencePath);
}

function extractOutputReferencePath(token: string): string | null {
  const expression = token.slice(2, -2).trim();
  const [referenceExpression] = expression.split("|", 1);
  if (referenceExpression === undefined) {
    return null;
  }

  const referencePath = referenceExpression.trim();
  return isSimpleReferencePath(referencePath) ? referencePath : null;
}

function validateTemplateTag(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  kind: WebhookTriggerTemplateKind;
  selectedEventReferences: SelectedEventReferencePaths;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const tagName = extractLiquidTagName(input.token);
  if (tagName === null) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template tags are not supported.",
    });
    return;
  }

  const allowedTagNames =
    input.kind === WebhookTriggerTemplateKinds.KEY
      ? KeyTemplateAllowedTagNames
      : ConditionalTemplateAllowedTagNames;
  if (!allowedTagNames.has(tagName)) {
    input.issues.push({
      field: input.field,
      message:
        input.kind === WebhookTriggerTemplateKinds.KEY
          ? `Liquid tag '${tagName}' is not supported in key templates.`
          : `Liquid tag '${tagName}' is not supported in trigger user message templates.`,
    });
    return;
  }

  if (input.kind === WebhookTriggerTemplateKinds.INPUT && isConditionalTagName(tagName)) {
    validateInputTemplateConditionReferences({
      field: input.field,
      token: input.token,
      tagName,
      allowedReferences: input.selectedEventReferences.all,
      issues: input.issues,
    });
  }
}

function isConditionalTagName(tagName: string): boolean {
  return tagName === "if" || tagName === "elsif" || tagName === "unless";
}

function validateInputTemplateConditionReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  token: string;
  tagName: string;
  allowedReferences: ReadonlySet<string>;
  issues: WebhookTriggerTemplateValidationIssue[];
}): void {
  const expression = extractTagExpression({
    token: input.token,
    tagName: input.tagName,
  });
  if (expression.includes("[") || expression.includes("]")) {
    input.issues.push({
      field: input.field,
      message: "Dynamic template references are not supported.",
    });
    return;
  }

  const referencePaths = extractConditionReferencePaths(expression);
  for (const referencePath of referencePaths) {
    if (!input.allowedReferences.has(referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${referencePath}}}'.`,
      });
    }
  }
}

function extractTagExpression(input: { token: string; tagName: string }): string {
  const expressionWithTag = trimLiquidInner(input.token);
  return expressionWithTag.slice(input.tagName.length).trim();
}

function extractConditionReferencePaths(expression: string): readonly string[] {
  const referencePaths: string[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const char = expression[cursor];
    if (char === undefined) {
      return referencePaths;
    }

    if (char === '"' || char === "'") {
      cursor = findQuotedStringEnd(expression, cursor, char);
      continue;
    }

    if (!isReferenceStartCharacter(char)) {
      cursor += 1;
      continue;
    }

    const referenceStart = cursor;
    cursor += 1;
    while (cursor < expression.length) {
      const nextChar = expression[cursor];
      if (nextChar === undefined || !isReferencePathCharacter(nextChar)) {
        break;
      }

      cursor += 1;
    }

    const referencePath = expression.slice(referenceStart, cursor);
    if (!NonReferenceConditionWords.has(referencePath) && isSimpleReferencePath(referencePath)) {
      referencePaths.push(referencePath);
    }
  }

  return referencePaths;
}

function findQuotedStringEnd(expression: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < expression.length) {
    if (expression[cursor] === quote) {
      return cursor + 1;
    }

    cursor += 1;
  }

  return expression.length;
}

function validateConditionalInputTemplateReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const allEventIndexes = input.selectedEventReferences.eventReferences.map(
    (_referenceSet, index) => index,
  );
  const stack: {
    parentReachableEventIndexes: readonly number[];
    consumedBranchReachableEventIndexes: readonly number[];
    unmodeledBranchFallbackReachableEventIndexes: readonly number[] | null;
  }[] = [];
  let reachableEventIndexes: readonly number[] = allEventIndexes;

  forEachLiquidToken(input.template, (token) => {
    if (token.startsWith("{{")) {
      const referencePath = extractOutputReferencePath(token);
      if (referencePath === null) {
        issues.push({
          field: input.field,
          message: "Dynamic template references are not supported.",
        });
      } else {
        validateReferencePathForReachableEvents({
          field: input.field,
          referencePath,
          reachableEventIndexes,
          selectedEventReferences: input.selectedEventReferences,
          issues,
        });
      }
      return;
    }

    const tagName = extractLiquidTagName(token);
    if (tagName === "if" || tagName === "unless") {
      const matchingEventIndexes = filterReachableEventsByModeledInputCondition({
        selectedEventReferences: input.selectedEventReferences,
        reachableEventIndexes,
        expression: extractTagExpression({ token, tagName }),
      });
      const branchReachableEventIndexes =
        matchingEventIndexes === null
          ? reachableEventIndexes
          : tagName === "if"
            ? matchingEventIndexes
            : subtractEventIndexes(reachableEventIndexes, matchingEventIndexes);
      const consumedBranchReachableEventIndexes =
        matchingEventIndexes === null ? [] : branchReachableEventIndexes;
      stack.push({
        parentReachableEventIndexes: reachableEventIndexes,
        consumedBranchReachableEventIndexes,
        unmodeledBranchFallbackReachableEventIndexes:
          matchingEventIndexes === null ? reachableEventIndexes : null,
      });
      reachableEventIndexes = branchReachableEventIndexes;
      return;
    }

    if (tagName === "elsif") {
      const currentFrame = stack.at(-1);
      if (currentFrame === undefined) {
        return;
      }

      const elseReachableEventIndexes =
        currentFrame.unmodeledBranchFallbackReachableEventIndexes ??
        subtractEventIndexes(
          currentFrame.parentReachableEventIndexes,
          currentFrame.consumedBranchReachableEventIndexes,
        );
      const modeledBranchReachableEventIndexes = filterReachableEventsByModeledInputCondition({
        selectedEventReferences: input.selectedEventReferences,
        reachableEventIndexes: elseReachableEventIndexes,
        expression: extractTagExpression({ token, tagName }),
      });
      const branchReachableEventIndexes =
        modeledBranchReachableEventIndexes ?? elseReachableEventIndexes;
      const unmodeledBranchFallbackReachableEventIndexes =
        currentFrame.unmodeledBranchFallbackReachableEventIndexes ??
        (modeledBranchReachableEventIndexes === null ? elseReachableEventIndexes : null);
      stack[stack.length - 1] = {
        parentReachableEventIndexes: currentFrame.parentReachableEventIndexes,
        consumedBranchReachableEventIndexes:
          unmodeledBranchFallbackReachableEventIndexes === null
            ? unionEventIndexes(
                currentFrame.consumedBranchReachableEventIndexes,
                branchReachableEventIndexes,
              )
            : currentFrame.consumedBranchReachableEventIndexes,
        unmodeledBranchFallbackReachableEventIndexes,
      };
      reachableEventIndexes = branchReachableEventIndexes;
      return;
    }

    if (tagName === "else") {
      const currentFrame = stack.at(-1);
      if (currentFrame !== undefined) {
        reachableEventIndexes =
          currentFrame.unmodeledBranchFallbackReachableEventIndexes ??
          subtractEventIndexes(
            currentFrame.parentReachableEventIndexes,
            currentFrame.consumedBranchReachableEventIndexes,
          );
      }
      return;
    }

    if (tagName === "endif" || tagName === "endunless") {
      const currentFrame = stack.pop();
      if (currentFrame !== undefined) {
        reachableEventIndexes = currentFrame.parentReachableEventIndexes;
      }
    }
  });

  return issues;
}

function filterReachableEventsByModeledInputCondition(input: {
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  expression: string;
}): readonly number[] | null {
  const eventType = extractWebhookEventTypeEqualityValue(input.expression);
  if (eventType !== null) {
    return filterReachableEventsByEventType({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: input.reachableEventIndexes,
      eventType,
    });
  }

  const referencePath = extractSimplePositiveConditionReferencePath(input.expression);
  if (referencePath === null) {
    return null;
  }

  return filterReachableEventsByReferencePaths({
    selectedEventReferences: input.selectedEventReferences,
    reachableEventIndexes: input.reachableEventIndexes,
    referencePaths: [referencePath],
  });
}

function extractSimplePositiveConditionReferencePath(expression: string): string | null {
  const trimmedExpression = expression.trim();
  if (!isSimpleReferencePath(trimmedExpression)) {
    return null;
  }

  return NonReferenceConditionWords.has(trimmedExpression) ? null : trimmedExpression;
}

function validateConditionalKeyTemplateReferences(input: {
  field: WebhookTriggerTemplateFieldName;
  template: string;
  selectedEventReferences: SelectedEventReferencePaths;
}): readonly WebhookTriggerTemplateValidationIssue[] {
  const issues: WebhookTriggerTemplateValidationIssue[] = [];
  const allEventIndexes = input.selectedEventReferences.eventReferences.map(
    (_referenceSet, index) => index,
  );
  const stack: {
    parentReachableEventIndexes: readonly number[];
    ifBranchReachableEventIndexes: readonly number[];
  }[] = [];
  let reachableEventIndexes: readonly number[] = allEventIndexes;

  forEachLiquidToken(input.template, (token) => {
    if (token.startsWith("{{")) {
      const referencePath = extractOutputReferencePath(token);
      if (referencePath === null) {
        issues.push({
          field: input.field,
          message: "Dynamic template references are not supported.",
        });
      } else {
        validateReferencePathForReachableEvents({
          field: input.field,
          referencePath,
          reachableEventIndexes,
          selectedEventReferences: input.selectedEventReferences,
          issues,
        });
      }
    } else {
      const tagName = extractLiquidTagName(token);
      if (tagName === "if") {
        const ifBranchReachableEventIndexes = filterReachableEventsByModeledKeyCondition({
          field: input.field,
          selectedEventReferences: input.selectedEventReferences,
          reachableEventIndexes,
          expression: extractTagExpression({ token, tagName }),
          issues,
        });
        stack.push({
          parentReachableEventIndexes: reachableEventIndexes,
          ifBranchReachableEventIndexes,
        });
        reachableEventIndexes = ifBranchReachableEventIndexes;
      } else if (tagName === "else") {
        const currentFrame = stack.at(-1);
        if (currentFrame !== undefined) {
          reachableEventIndexes = currentFrame.parentReachableEventIndexes.filter(
            (eventIndex) => !currentFrame.ifBranchReachableEventIndexes.includes(eventIndex),
          );
        }
      } else if (tagName === "endif") {
        const currentFrame = stack.pop();
        if (currentFrame !== undefined) {
          reachableEventIndexes = currentFrame.parentReachableEventIndexes;
        }
      }
    }
  });

  return issues;
}

function extractLiquidTagName(token: string): string | null {
  const inner = trimLiquidInner(token);
  const firstChar = inner[0];
  if (firstChar === undefined || !isReferenceStartCharacter(firstChar)) {
    return null;
  }

  let cursor = 1;
  while (cursor < inner.length) {
    const char = inner[cursor];
    if (char === undefined || (!isReferencePathCharacter(char) && char !== "-")) {
      break;
    }

    cursor += 1;
  }

  return inner.slice(0, cursor);
}

function filterReachableEventsByModeledKeyCondition(input: {
  field: WebhookTriggerTemplateFieldName;
  selectedEventReferences: SelectedEventReferencePaths;
  reachableEventIndexes: readonly number[];
  expression: string;
  issues: WebhookTriggerTemplateValidationIssue[];
}): readonly number[] {
  const eventType = extractWebhookEventTypeEqualityValue(input.expression);
  if (eventType !== null) {
    return filterReachableEventsByEventType({
      selectedEventReferences: input.selectedEventReferences,
      reachableEventIndexes: input.reachableEventIndexes,
      eventType,
    });
  }

  const referencePath = extractSimplePositiveConditionReferencePath(input.expression);
  if (referencePath !== null) {
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

    return input.referencePaths.every((referencePath) => eventReferences.has(referencePath));
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

    if (!eventReferences.has(input.referencePath)) {
      input.issues.push({
        field: input.field,
        message: `Unsupported trigger event field reference '{{${input.referencePath}}}'.`,
      });
      return;
    }
  }
}

function trimLiquidInner(token: string): string {
  let inner = token.slice(2, -2).trim();
  if (inner.startsWith("-")) {
    inner = inner.slice(1).trimStart();
  }

  if (inner.endsWith("-")) {
    inner = inner.slice(0, -1).trimEnd();
  }

  return inner;
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

function isReferencePathCharacter(char: string): boolean {
  return char === "." || isReferenceChildCharacter(char);
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

function buildSelectedEventReferencePaths(
  selectedEvents: readonly IntegrationWebhookEventDefinition[],
): SelectedEventReferencePaths {
  const perEventReferences = selectedEvents.map(buildEventReferencePaths);

  return {
    all:
      perEventReferences.length === 0
        ? new Set(SharedAllowedReferencePaths)
        : unionReferencePaths(perEventReferences),
    common:
      perEventReferences.length === 0
        ? new Set(SharedAllowedReferencePaths)
        : intersectReferencePaths(perEventReferences),
    eventReferences: perEventReferences,
    eventTypes: selectedEvents.map((eventDefinition) => eventDefinition.eventType),
  };
}

function buildEventReferencePaths(
  eventDefinition: IntegrationWebhookEventDefinition,
): ReadonlySet<string> {
  const references = new Set(SharedAllowedReferencePaths);

  for (const payloadReference of eventDefinition.payloadReferences ?? []) {
    addPayloadReferencePath(references, payloadReference.path);
  }

  return references;
}

function unionReferencePaths(referenceSets: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const union = new Set<string>();
  for (const referenceSet of referenceSets) {
    for (const reference of referenceSet) {
      union.add(reference);
    }
  }

  return union;
}

function intersectReferencePaths(
  referenceSets: readonly ReadonlySet<string>[],
): ReadonlySet<string> {
  const [firstReferenceSet, ...remainingReferenceSets] = referenceSets;
  if (firstReferenceSet === undefined) {
    return new Set();
  }

  const intersection = new Set(firstReferenceSet);
  for (const reference of firstReferenceSet) {
    if (!remainingReferenceSets.every((referenceSet) => referenceSet.has(reference))) {
      intersection.delete(reference);
    }
  }

  return intersection;
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
