import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  AnyIntegrationDefinition,
  IntegrationDefinitionLocator,
  IntegrationDefinitionResolver,
} from "../types/index.js";

function createDefinitionKey(input: IntegrationDefinitionLocator): string {
  return `${input.familyId}::${input.variantId}`;
}

function validateDefinition(input: AnyIntegrationDefinition): void {
  if (input.familyId.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition familyId must be non-empty.",
    );
  }

  if (input.variantId.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition variantId must be non-empty.",
    );
  }

  if (input.displayName.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition displayName must be non-empty.",
    );
  }

  if (input.logoKey.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition logoKey must be non-empty.",
    );
  }

  for (const supportedWebhookEvent of input.supportedWebhookEvents ?? []) {
    if (supportedWebhookEvent.eventType.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].eventType must be non-empty.",
      );
    }

    if (supportedWebhookEvent.providerEventType.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].providerEventType must be non-empty.",
      );
    }

    if (supportedWebhookEvent.displayName.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].displayName must be non-empty.",
      );
    }

    for (const parameter of supportedWebhookEvent.parameters ?? []) {
      if (parameter.id.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].id must be non-empty.",
        );
      }

      if (parameter.label.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].label must be non-empty.",
        );
      }

      if (parameter.resourceKind.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].resourceKind must be non-empty.",
        );
      }

      if (parameter.payloadPath.length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].payloadPath must be non-empty.",
        );
      }
    }
  }
}

export class IntegrationRegistry implements IntegrationDefinitionResolver {
  readonly #definitionsByKey = new Map<string, AnyIntegrationDefinition>();

  register(input: AnyIntegrationDefinition): void {
    validateDefinition(input);

    const key = createDefinitionKey({
      familyId: input.familyId,
      variantId: input.variantId,
    });

    if (this.#definitionsByKey.has(key)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
        `Integration definition '${key}' is already registered.`,
      );
    }

    this.#definitionsByKey.set(key, input);
  }

  registerMany(input: ReadonlyArray<AnyIntegrationDefinition>): void {
    for (const definition of input) {
      this.register(definition);
    }
  }

  getDefinition(input: IntegrationDefinitionLocator): AnyIntegrationDefinition | undefined {
    return this.#definitionsByKey.get(createDefinitionKey(input));
  }

  getDefinitionOrThrow(input: IntegrationDefinitionLocator): AnyIntegrationDefinition {
    const definition = this.getDefinition(input);

    if (definition === undefined) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DEFINITION_NOT_FOUND,
        `Integration definition '${createDefinitionKey(input)}' was not found.`,
      );
    }

    return definition;
  }

  listDefinitions(): ReadonlyArray<AnyIntegrationDefinition> {
    return [...this.#definitionsByKey.values()].sort((left, right) => {
      const familyComparison = left.familyId.localeCompare(right.familyId);
      if (familyComparison !== 0) {
        return familyComparison;
      }

      return left.variantId.localeCompare(right.variantId);
    });
  }
}

export { createDefinitionKey };
