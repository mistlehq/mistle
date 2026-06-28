import type {
  DiscoveredIntegrationResourceRelationship,
  DiscoveredIntegrationResourceRelationshipScope,
} from "@mistle/integrations-core";
import { z } from "zod";

const DiscoveredIntegrationResourceRelationshipSchema = z
  .object({
    relationshipKind: z.string().min(1),
    subjectResourceKind: z.string().min(1),
    subjectExternalId: z.string().min(1).optional(),
    subjectHandle: z.string().min(1),
    objectResourceKind: z.string().min(1),
    objectExternalId: z.string().min(1).optional(),
    objectHandle: z.string().min(1),
    scopeKind: z.string().min(1),
    scopeExternalId: z.string().min(1).optional(),
    scopeHandle: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

const DiscoveredIntegrationResourceRelationshipScopeSchema = z
  .object({
    scopeKind: z.string().min(1),
    scopeExternalId: z.string().min(1).optional(),
    scopeHandle: z.string().min(1),
  })
  .strict();

type ParsedDiscoveredIntegrationResourceRelationship = z.infer<
  typeof DiscoveredIntegrationResourceRelationshipSchema
>;

type ParsedDiscoveredIntegrationResourceRelationshipScope = z.infer<
  typeof DiscoveredIntegrationResourceRelationshipScopeSchema
>;

export function validateDiscoveredResourceRelationships(input: {
  relationshipKind: string;
  subjectResourceKind: string;
  objectResourceKind: string;
  scope: DiscoveredIntegrationResourceRelationshipScope;
  relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship>;
}): ReadonlyArray<DiscoveredIntegrationResourceRelationship> {
  if (input.relationshipKind.length === 0) {
    throw new Error("Resource sync relationship validation requested an empty relationship kind.");
  }
  if (input.subjectResourceKind.length === 0) {
    throw new Error(
      "Resource sync relationship validation requested an empty subject resource kind.",
    );
  }
  if (input.objectResourceKind.length === 0) {
    throw new Error(
      "Resource sync relationship validation requested an empty object resource kind.",
    );
  }

  const scope = DiscoveredIntegrationResourceRelationshipScopeSchema.parse(input.scope);
  const parsedRelationships = z
    .array(DiscoveredIntegrationResourceRelationshipSchema)
    .parse(input.relationships);
  const seenRelationshipKeys = new Set<string>();

  for (const relationship of parsedRelationships) {
    validateRelationshipMatchesRequest({
      requestedRelationshipKind: input.relationshipKind,
      requestedSubjectResourceKind: input.subjectResourceKind,
      requestedObjectResourceKind: input.objectResourceKind,
      requestedScope: scope,
      relationship,
    });

    const relationshipKey = discoveredRelationshipKey(relationship);
    if (seenRelationshipKeys.has(relationshipKey)) {
      throw new Error(
        `Provider returned duplicate relationship '${relationship.relationshipKind}' from '${relationship.subjectHandle}' to '${relationship.objectHandle}' in scope '${relationship.scopeHandle}'.`,
      );
    }
    seenRelationshipKeys.add(relationshipKey);
  }

  return parsedRelationships.map(normalizeParsedRelationship);
}

function validateRelationshipMatchesRequest(input: {
  requestedRelationshipKind: string;
  requestedSubjectResourceKind: string;
  requestedObjectResourceKind: string;
  requestedScope: ParsedDiscoveredIntegrationResourceRelationshipScope;
  relationship: ParsedDiscoveredIntegrationResourceRelationship;
}): void {
  if (input.relationship.relationshipKind !== input.requestedRelationshipKind) {
    throw new Error(
      `Provider returned relationship kind '${input.relationship.relationshipKind}' while syncing '${input.requestedRelationshipKind}'.`,
    );
  }

  if (input.relationship.subjectResourceKind !== input.requestedSubjectResourceKind) {
    throw new Error(
      `Provider returned relationship subject resource kind '${input.relationship.subjectResourceKind}' while syncing '${input.requestedSubjectResourceKind}'.`,
    );
  }

  if (input.relationship.objectResourceKind !== input.requestedObjectResourceKind) {
    throw new Error(
      `Provider returned relationship object resource kind '${input.relationship.objectResourceKind}' while syncing '${input.requestedObjectResourceKind}'.`,
    );
  }

  if (input.relationship.scopeKind !== input.requestedScope.scopeKind) {
    throw new Error(
      `Provider returned relationship scope kind '${input.relationship.scopeKind}' while syncing '${input.requestedScope.scopeKind}'.`,
    );
  }

  if (input.relationship.scopeHandle !== input.requestedScope.scopeHandle) {
    throw new Error(
      `Provider returned relationship scope handle '${input.relationship.scopeHandle}' while syncing '${input.requestedScope.scopeHandle}'.`,
    );
  }

  if (input.relationship.scopeExternalId !== input.requestedScope.scopeExternalId) {
    throw new Error(
      `Provider returned relationship scope external id '${input.relationship.scopeExternalId ?? "<none>"}' while syncing '${input.requestedScope.scopeExternalId ?? "<none>"}'.`,
    );
  }
}

function discoveredRelationshipKey(
  relationship: ParsedDiscoveredIntegrationResourceRelationship,
): string {
  return JSON.stringify([
    relationship.relationshipKind,
    relationship.scopeKind,
    relationship.scopeExternalId ?? null,
    relationship.scopeHandle,
    relationship.subjectResourceKind,
    relationship.subjectHandle,
    relationship.objectResourceKind,
    relationship.objectHandle,
  ]);
}

function normalizeParsedRelationship(
  relationship: ParsedDiscoveredIntegrationResourceRelationship,
): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: relationship.relationshipKind,
    subjectResourceKind: relationship.subjectResourceKind,
    ...(relationship.subjectExternalId === undefined
      ? {}
      : { subjectExternalId: relationship.subjectExternalId }),
    subjectHandle: relationship.subjectHandle,
    objectResourceKind: relationship.objectResourceKind,
    ...(relationship.objectExternalId === undefined
      ? {}
      : { objectExternalId: relationship.objectExternalId }),
    objectHandle: relationship.objectHandle,
    scopeKind: relationship.scopeKind,
    ...(relationship.scopeExternalId === undefined
      ? {}
      : { scopeExternalId: relationship.scopeExternalId }),
    scopeHandle: relationship.scopeHandle,
    metadata: relationship.metadata,
  };
}
