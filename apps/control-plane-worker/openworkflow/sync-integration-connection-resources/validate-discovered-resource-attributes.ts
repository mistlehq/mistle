import type {
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceAttribute,
  IntegrationResourceAttributeDefinition,
  IntegrationResourceAttributeValueType,
} from "@mistle/integrations-core";
import { z } from "zod";

const DiscoveredIntegrationResourceAttributeSchema = z
  .object({
    resourceKind: z.string().min(1),
    resourceExternalId: z.string().min(1).optional(),
    resourceHandle: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    valueType: z.enum(["boolean", "number", "string"]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

type ParsedDiscoveredIntegrationResourceAttribute = z.infer<
  typeof DiscoveredIntegrationResourceAttributeSchema
>;

type ResourceIdentity = {
  kind: "external_id" | "handle";
  value: string;
};

type ResourceIdentityCandidate = {
  externalId?: string;
  handle: string;
};

export function validateDiscoveredResourceAttributes(input: {
  resourceKind: string;
  resources: ReadonlyArray<DiscoveredIntegrationResource>;
  accessibleResources?: ReadonlyArray<ResourceIdentityCandidate>;
  attributes?: ReadonlyArray<DiscoveredIntegrationResourceAttribute>;
  attributeDefinitions?: ReadonlyArray<IntegrationResourceAttributeDefinition>;
}): ReadonlyArray<DiscoveredIntegrationResourceAttribute> {
  const parsedAttributes = z
    .array(DiscoveredIntegrationResourceAttributeSchema)
    .parse(input.attributes ?? []);
  const definitionsByKey = buildAttributeDefinitionsByKey(input.attributeDefinitions ?? []);
  const resourcesByIdentity = buildResourceIdentityIndex([
    ...(input.accessibleResources ?? []),
    ...input.resources,
  ]);
  const seenAttributeKeys = new Set<string>();

  for (const attribute of parsedAttributes) {
    if (attribute.resourceKind !== input.resourceKind) {
      throw new Error(
        `Provider returned attribute '${attribute.key}' for resource kind '${attribute.resourceKind}' while syncing '${input.resourceKind}'.`,
      );
    }

    const definition = definitionsByKey.get(attribute.key);
    if (definition === undefined) {
      throw new Error(
        `Provider returned undeclared attribute '${attribute.key}' for resource kind '${input.resourceKind}'.`,
      );
    }
    if (definition.valueType !== attribute.valueType) {
      throw new Error(
        `Provider returned attribute '${attribute.key}' with value type '${attribute.valueType}' but declared '${definition.valueType}'.`,
      );
    }
    validateCanonicalAttributeValue(attribute);

    const resourceIdentity = resolveAttributeResourceIdentity({
      attribute,
      resourcesByIdentity,
    });
    const attributeIdentity = resourceAttributeIdentityKey({
      resourceIdentity,
      attributeKey: attribute.key,
    });
    if (seenAttributeKeys.has(attributeIdentity)) {
      throw new Error(
        `Provider returned duplicate attribute '${attribute.key}' for resource '${attribute.resourceHandle}'.`,
      );
    }
    seenAttributeKeys.add(attributeIdentity);
  }

  for (const definition of definitionsByKey.values()) {
    if (definition.actorPolicyEligible !== true) {
      continue;
    }

    for (const resource of input.resources) {
      const resourceIdentity = discoveredResourceIdentity(resource);
      const attributeIdentity = resourceAttributeIdentityKey({
        resourceIdentity,
        attributeKey: definition.key,
      });
      if (!seenAttributeKeys.has(attributeIdentity)) {
        throw new Error(
          `Provider omitted actor-policy attribute '${definition.key}' for resource '${resource.handle}'.`,
        );
      }
    }
  }

  return parsedAttributes.map(normalizeParsedAttribute);
}

function buildAttributeDefinitionsByKey(
  definitions: ReadonlyArray<IntegrationResourceAttributeDefinition>,
): ReadonlyMap<string, IntegrationResourceAttributeDefinition> {
  const definitionsByKey = new Map<string, IntegrationResourceAttributeDefinition>();

  for (const definition of definitions) {
    if (definition.key.length === 0) {
      throw new Error("Provider declared an empty resource attribute key.");
    }
    if (definitionsByKey.has(definition.key)) {
      throw new Error(`Provider declared duplicate resource attribute key '${definition.key}'.`);
    }
    definitionsByKey.set(definition.key, definition);
  }

  return definitionsByKey;
}

function buildResourceIdentityIndex(resources: ReadonlyArray<ResourceIdentityCandidate>): {
  byExternalId: ReadonlyMap<string, ResourceIdentityCandidate>;
  byHandle: ReadonlyMap<string, ResourceIdentityCandidate>;
} {
  const byExternalId = new Map<string, ResourceIdentityCandidate>();
  const byHandle = new Map<string, ResourceIdentityCandidate>();

  for (const resource of resources) {
    byHandle.set(resource.handle, resource);
    if (resource.externalId !== undefined) {
      byExternalId.set(resource.externalId, resource);
    }
  }

  return { byExternalId, byHandle };
}

function resolveAttributeResourceIdentity(input: {
  attribute: ParsedDiscoveredIntegrationResourceAttribute;
  resourcesByIdentity: {
    byExternalId: ReadonlyMap<string, ResourceIdentityCandidate>;
    byHandle: ReadonlyMap<string, ResourceIdentityCandidate>;
  };
}): ResourceIdentity {
  const matchedResource =
    input.attribute.resourceExternalId === undefined
      ? input.resourcesByIdentity.byHandle.get(input.attribute.resourceHandle)
      : input.resourcesByIdentity.byExternalId.get(input.attribute.resourceExternalId);

  if (matchedResource === undefined) {
    throw new Error(
      `Provider returned attribute '${input.attribute.key}' for unknown resource '${input.attribute.resourceHandle}'.`,
    );
  }
  if (matchedResource.handle !== input.attribute.resourceHandle) {
    throw new Error(
      `Provider returned attribute '${input.attribute.key}' for external resource '${input.attribute.resourceExternalId}' with mismatched handle '${input.attribute.resourceHandle}'.`,
    );
  }

  return discoveredResourceIdentity(matchedResource);
}

function discoveredResourceIdentity(resource: ResourceIdentityCandidate): ResourceIdentity {
  return resource.externalId === undefined
    ? { kind: "handle", value: resource.handle }
    : { kind: "external_id", value: resource.externalId };
}

function resourceAttributeIdentityKey(input: {
  resourceIdentity: ResourceIdentity;
  attributeKey: string;
}): string {
  return JSON.stringify([
    input.resourceIdentity.kind,
    input.resourceIdentity.value,
    input.attributeKey,
  ]);
}

function validateCanonicalAttributeValue(attribute: {
  key: string;
  value: string;
  valueType: IntegrationResourceAttributeValueType;
}): void {
  if (attribute.valueType === "boolean") {
    if (attribute.value !== "true" && attribute.value !== "false") {
      throw new Error(
        `Provider returned boolean attribute '${attribute.key}' with non-canonical value '${attribute.value}'.`,
      );
    }
    return;
  }

  if (attribute.valueType === "number") {
    const numericValue = Number(attribute.value);
    if (!Number.isFinite(numericValue) || String(numericValue) !== attribute.value) {
      throw new Error(
        `Provider returned number attribute '${attribute.key}' with non-canonical value '${attribute.value}'.`,
      );
    }
  }
}

function normalizeParsedAttribute(
  attribute: ParsedDiscoveredIntegrationResourceAttribute,
): DiscoveredIntegrationResourceAttribute {
  return {
    resourceKind: attribute.resourceKind,
    ...(attribute.resourceExternalId === undefined
      ? {}
      : { resourceExternalId: attribute.resourceExternalId }),
    resourceHandle: attribute.resourceHandle,
    key: attribute.key,
    value: attribute.value,
    valueType: attribute.valueType,
    metadata: attribute.metadata,
  };
}
