import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";
import { Liquid } from "liquidjs";

const TemplateReferenceEngine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

const PayloadRootSegment = "payload";

export function assertWebhookTriggerInputTemplateReferencesOrThrow(input: {
  inputTemplate: string;
  eventTypes: readonly string[];
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const payloadReferences = extractInputTemplatePayloadReferences(input.inputTemplate);

  for (const payloadReference of payloadReferences) {
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

function extractInputTemplatePayloadReferences(inputTemplate: string): {
  path: readonly string[];
  displayPath: string;
}[] {
  let variableSegments;
  try {
    variableSegments = TemplateReferenceEngine.variableSegmentsSync(inputTemplate);
  } catch (error) {
    throw new BadRequestError(
      "VALIDATION_ERROR",
      `Invalid inputTemplate Liquid syntax: ${getErrorMessage(error)}`,
    );
  }

  const references = new Map<string, { path: readonly string[]; displayPath: string }>();
  for (const variableSegment of variableSegments) {
    const payloadReferencePath = normalizePayloadReferencePath(variableSegment);
    if (payloadReferencePath === null) {
      continue;
    }

    const displayPath = formatPayloadReferencePath(payloadReferencePath);
    references.set(displayPath, {
      path: payloadReferencePath,
      displayPath,
    });
  }

  return [...references.values()];
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

function formatPayloadReferencePath(path: readonly string[]): string {
  if (path.length === 0) {
    return PayloadRootSegment;
  }

  return [PayloadRootSegment, ...path].join(".");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Template could not be parsed.";
}
