import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  AnyIntegrationDefinition,
  IntegrationDefinitionLocator,
  IntegrationDefinitionResolver,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookTriggerRequirements,
} from "../types/index.js";

function createDefinitionKey(input: IntegrationDefinitionLocator): string {
  return `${input.familyId}::${input.variantId}`;
}

function isEqualityStyleWebhookEventParameter(
  parameter: IntegrationWebhookEventParameterDefinition,
): boolean {
  if (parameter.kind === "resource-select") {
    return true;
  }

  if (parameter.kind === "string") {
    return parameter.matchMode === undefined || parameter.matchMode === "eq";
  }

  return parameter.matchMode === "eq";
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

    validateWebhookTriggerRequirements(supportedWebhookEvent.requirements);

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

    const parameterIds = new Set<string>();
    for (const parameter of supportedWebhookEvent.parameters ?? []) {
      if (parameter.id.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].id must be non-empty.",
        );
      }

      if (parameterIds.has(parameter.id)) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          `Integration definition supportedWebhookEvents[*].parameters contains duplicate id '${parameter.id}'.`,
        );
      }

      parameterIds.add(parameter.id);

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

      if (
        parameter.negatedMatchRequiresExists === true &&
        !isEqualityStyleWebhookEventParameter(parameter)
      ) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameters[*].negatedMatchRequiresExists is only supported for equality parameters.",
        );
      }
    }

    const parametersById = new Map(
      (supportedWebhookEvent.parameters ?? []).map((parameter) => [parameter.id, parameter]),
    );
    const parameterGroupIds = new Set<string>();
    const groupedParameterIds = new Set<string>();
    for (const parameterGroup of supportedWebhookEvent.parameterGroups ?? []) {
      if (parameterGroup.id.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameterGroups[*].id must be non-empty.",
        );
      }

      if (parameterGroupIds.has(parameterGroup.id)) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          `Integration definition supportedWebhookEvents[*].parameterGroups contains duplicate id '${parameterGroup.id}'.`,
        );
      }

      parameterGroupIds.add(parameterGroup.id);

      if (parameterGroup.label.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameterGroups[*].label must be non-empty.",
        );
      }

      if (parameterGroup.options.length < 2) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].parameterGroups[*].options must contain at least two options.",
        );
      }

      const optionParameterIds = new Set<string>();
      for (const option of parameterGroup.options) {
        if (option.parameterId.trim().length === 0) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].parameterId must be non-empty.",
          );
        }

        if (option.label.trim().length === 0) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].label must be non-empty.",
          );
        }

        const parameter = parametersById.get(option.parameterId);
        if (parameter === undefined) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].parameterId must reference an existing parameter.",
          );
        }

        if (!isEqualityStyleWebhookEventParameter(parameter)) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].parameterId must reference an equality parameter.",
          );
        }

        if (optionParameterIds.has(option.parameterId)) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].parameterId must be unique within a parameter group.",
          );
        }

        if (groupedParameterIds.has(option.parameterId)) {
          throw new IntegrationDefinitionRegistryError(
            DefinitionRegistryErrorCodes.INVALID_DEFINITION,
            "Integration definition supportedWebhookEvents[*].parameterGroups[*].options[*].parameterId must reference a parameter that is not used by another parameter group.",
          );
        }

        optionParameterIds.add(option.parameterId);
        groupedParameterIds.add(option.parameterId);
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

function validateWebhookTriggerRequirements(
  requirements: IntegrationWebhookTriggerRequirements | undefined,
): void {
  if (requirements === undefined) {
    return;
  }

  if (requirements.anyOf.length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition supportedWebhookEvents[*].requirements.anyOf must contain at least one requirement set.",
    );
  }

  for (const requirementSet of requirements.anyOf) {
    if (requirementSet.event === undefined && (requirementSet.permissions?.length ?? 0) === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].requirements.anyOf[*] must contain an event or permission.",
      );
    }

    if (requirementSet.label !== undefined && requirementSet.label.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].requirements.anyOf[*].label must be non-empty.",
      );
    }

    if (requirementSet.event !== undefined && requirementSet.event.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Integration definition supportedWebhookEvents[*].requirements.anyOf[*].event must be non-empty.",
      );
    }

    for (const permission of requirementSet.permissions ?? []) {
      if (permission.permission.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].requirements.anyOf[*].permissions[*].permission must be non-empty.",
        );
      }

      if (permission.access !== undefined && permission.access.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          "Integration definition supportedWebhookEvents[*].requirements.anyOf[*].permissions[*].access must be non-empty.",
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
