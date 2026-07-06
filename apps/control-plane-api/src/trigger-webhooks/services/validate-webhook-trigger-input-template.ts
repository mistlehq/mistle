import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";
import { WebhookEventTemplateFields } from "@mistle/integrations-core/triggers";
import { Liquid } from "liquidjs";

const TemplateReferenceEngine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

const PayloadRootSegment = "payload";
const WebhookEventRootSegment = "webhookEvent";
const SupportedWebhookEventTemplateFields = new Set<string>(
  Object.values(WebhookEventTemplateFields),
);

export function assertWebhookTriggerInputTemplateReferencesOrThrow(input: {
  inputTemplate: string;
  eventTypes: readonly string[];
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const templateReferences = extractInputTemplateReferences(input.inputTemplate);

  for (const webhookEventReference of templateReferences.webhookEventReferences) {
    if (webhookEventReference.path.length === 0) {
      continue;
    }

    if (
      webhookEventReference.path.length !== 1 ||
      !isSupportedWebhookEventField(webhookEventReference.path[0])
    ) {
      throw new BadRequestError(
        "VALIDATION_ERROR",
        `Invalid inputTemplate webhookEvent reference: ${webhookEventReference.displayPath} is not a supported webhook event field.`,
      );
    }
  }

  for (const payloadReference of templateReferences.payloadReferences) {
    if (payloadReference.path.length === 0) {
      continue;
    }

    if (
      !isPayloadReferenceDeclaredBySelectedEvent({
        path: payloadReference.path,
        eventTypes: input.eventTypes,
        supportedWebhookEvents: input.supportedWebhookEvents,
      })
    ) {
      throw new BadRequestError(
        "VALIDATION_ERROR",
        `Invalid inputTemplate payload reference: ${payloadReference.displayPath} is not declared by any selected trigger event.`,
      );
    }
  }
}

function extractInputTemplateReferences(inputTemplate: string): {
  payloadReferences: {
    path: readonly string[];
    displayPath: string;
  }[];
  webhookEventReferences: {
    path: readonly string[];
    displayPath: string;
  }[];
} {
  let variableSegments: ReturnType<Liquid["variableSegmentsSync"]>;
  try {
    variableSegments = TemplateReferenceEngine.variableSegmentsSync(inputTemplate);
  } catch (error) {
    throw new BadRequestError(
      "VALIDATION_ERROR",
      `Invalid inputTemplate Liquid syntax: ${getErrorMessage(error)}`,
    );
  }

  const payloadReferences = new Map<string, { path: readonly string[]; displayPath: string }>();
  const webhookEventReferences = new Map<
    string,
    { path: readonly string[]; displayPath: string }
  >();
  for (const variableSegment of variableSegments) {
    const payloadReferencePath = normalizePayloadReferencePath(variableSegment);
    if (payloadReferencePath !== null) {
      const displayPath = formatReferencePath(PayloadRootSegment, payloadReferencePath);
      payloadReferences.set(displayPath, {
        path: payloadReferencePath,
        displayPath,
      });
    }

    const webhookEventReferencePath = normalizeWebhookEventReferencePath(variableSegment);
    if (webhookEventReferencePath !== null) {
      const displayPath = formatReferencePath(WebhookEventRootSegment, webhookEventReferencePath);
      webhookEventReferences.set(displayPath, {
        path: webhookEventReferencePath,
        displayPath,
      });
    }
  }

  return {
    payloadReferences: [...payloadReferences.values()],
    webhookEventReferences: [...webhookEventReferences.values()],
  };
}

function normalizePayloadReferencePath(input: readonly unknown[]): readonly string[] | null {
  const [rootSegment, ...remainingSegments] = input;
  if (rootSegment !== PayloadRootSegment) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of remainingSegments) {
    if (typeof segment === "number") {
      continue;
    }

    if (typeof segment !== "string") {
      throw new BadRequestError(
        "VALIDATION_ERROR",
        "Invalid inputTemplate payload reference: dynamic payload paths are not supported.",
      );
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments;
}

function normalizeWebhookEventReferencePath(input: readonly unknown[]): readonly string[] | null {
  const [rootSegment, ...remainingSegments] = input;
  if (rootSegment !== WebhookEventRootSegment) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of remainingSegments) {
    if (typeof segment !== "string") {
      throw new BadRequestError(
        "VALIDATION_ERROR",
        "Invalid inputTemplate webhookEvent reference: dynamic webhookEvent paths are not supported.",
      );
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments;
}

function isSupportedWebhookEventField(input: string | undefined): boolean {
  return input !== undefined && SupportedWebhookEventTemplateFields.has(input);
}

function isPayloadReferenceDeclaredBySelectedEvent(input: {
  path: readonly string[];
  eventTypes: readonly string[];
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): boolean {
  return input.eventTypes.some((eventType) => {
    const eventDefinition = input.supportedWebhookEvents.find(
      (candidateDefinition) => candidateDefinition.eventType === eventType,
    );
    if (eventDefinition === undefined) {
      return false;
    }

    return (eventDefinition.payloadReferences ?? []).some(
      (payloadReference) =>
        pathsAreEqual(payloadReference.path, input.path) ||
        (payloadReference.allowsDescendants === true &&
          pathIsAncestor(payloadReference.path, input.path)),
    );
  });
}

function pathsAreEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function pathIsAncestor(
  candidateAncestor: readonly string[],
  descendant: readonly string[],
): boolean {
  return (
    candidateAncestor.length < descendant.length &&
    candidateAncestor.every((segment, index) => segment === descendant[index])
  );
}

function formatReferencePath(rootSegment: string, path: readonly string[]): string {
  if (path.length === 0) {
    return rootSegment;
  }

  return [rootSegment, ...path].join(".");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Template could not be parsed.";
}
