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

  const identityLinking = input.identityLinking;
  if (identityLinking !== undefined) {
    const definedConnectionMethodIds = new Set(input.connectionMethods.map((method) => method.id));
    const eligibleConnectionMethodIds = new Set<string>();

    if (identityLinking.eligibleConnectionMethodIds.length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition identityLinking.eligibleConnectionMethodIds must be non-empty.",
      );
    }

    for (const eligibleConnectionMethodId of identityLinking.eligibleConnectionMethodIds) {
      if (eligibleConnectionMethodId.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition identityLinking.eligibleConnectionMethodIds[*] must be non-empty.",
        );
      }

      if (!definedConnectionMethodIds.has(eligibleConnectionMethodId)) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition identityLinking.eligibleConnectionMethodIds[*] must reference an existing connection method id.",
        );
      }

      if (eligibleConnectionMethodIds.has(eligibleConnectionMethodId)) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          `Integration definition identityLinking contains duplicate eligible connection method id '${eligibleConnectionMethodId}'.`,
        );
      }

      eligibleConnectionMethodIds.add(eligibleConnectionMethodId);
    }
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

    for (const conversationKeyOption of supportedWebhookEvent.conversationKeyOptions ?? []) {
      if (conversationKeyOption.id.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].conversationKeyOptions[*].id must be non-empty.",
        );
      }

      if (conversationKeyOption.label.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].conversationKeyOptions[*].label must be non-empty.",
        );
      }

      if (conversationKeyOption.description.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].conversationKeyOptions[*].description must be non-empty.",
        );
      }

      if (conversationKeyOption.template.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].conversationKeyOptions[*].template must be non-empty.",
        );
      }
    }

    for (const payloadReference of supportedWebhookEvent.payloadReferences ?? []) {
      if (payloadReference.path.length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].payloadReferences[*].path must be non-empty.",
        );
      }

      if (payloadReference.path.some((segment) => segment.trim().length === 0)) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].payloadReferences[*].path[*] must be non-empty.",
        );
      }

      if (payloadReference.description.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].payloadReferences[*].description must be non-empty.",
        );
      }
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

      if (
        parameter.kind === "resource-select" &&
        (parameter.resourceKind?.trim().length ?? 0) === 0
      ) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].resourceKind must be non-empty.",
        );
      }

      if (
        parameter.kind === "enum-select" &&
        parameter.options.some(
          (option) => option.value.trim().length === 0 || option.label.trim().length === 0,
        )
      ) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].options[*] must be non-empty.",
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

  const middlewareIds = new Set<string>();
  for (const middleware of input.egressRequestMiddleware ?? []) {
    if (middleware.id.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition egressRequestMiddleware[*].id must be non-empty.",
      );
    }

    if (middlewareIds.has(middleware.id)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        `Integration definition egressRequestMiddleware contains duplicate id '${middleware.id}'.`,
      );
    }

    middlewareIds.add(middleware.id);
  }

  const webhookSource = input.webhookSource;
  if (webhookSource === undefined) {
    return;
  }

  if (webhookSource.lifecycle.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition webhookSource.lifecycle must be non-empty.",
    );
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
