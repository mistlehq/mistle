import type {
  DiscoveredIntegrationResourceRelationship,
  DiscoveredIntegrationResourceRelationshipScope,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { validateDiscoveredResourceRelationships } from "./validate-discovered-resource-relationships.js";

const SlackUserGroupScope: DiscoveredIntegrationResourceRelationshipScope = {
  scopeKind: "user_group",
  scopeExternalId: "S123",
  scopeHandle: "engineering",
};

const SlackUserGroupMembershipRequest = {
  relationshipKind: "belongs_to",
  subjectResourceKind: "user",
  objectResourceKind: "user_group",
  scope: SlackUserGroupScope,
};

describe("validateDiscoveredResourceRelationships", () => {
  it("accepts relationships that exactly match the requested kind and scope", () => {
    const relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship> = [
      slackUserGroupMembership({
        subjectExternalId: "U123",
        subjectHandle: "alice",
        objectExternalId: "S123",
        objectHandle: "engineering",
      }),
      slackUserGroupMembership({
        subjectExternalId: "U456",
        subjectHandle: "bob",
        objectExternalId: "S123",
        objectHandle: "engineering",
        metadata: {
          source: "usergroups.users.list",
        },
      }),
    ];

    expect(
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships,
      }),
    ).toEqual(relationships);
  });

  it("rejects omitted relationships instead of treating them as an empty complete scope snapshot", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        // @ts-expect-error: malformed provider boundary input should still fail fast at runtime.
        relationships: undefined,
      }),
    ).toThrow("Invalid input: expected array");
  });

  it("rejects missing required subject, object, and scope identifiers", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectExternalId: "",
            subjectHandle: "",
            objectExternalId: "",
            objectHandle: "",
            scopeExternalId: "",
            scopeHandle: "",
          }),
        ],
      }),
    ).toThrow("Too small: expected string to have >=1 characters");
  });

  it("rejects an empty requested relationship kind", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationshipKind: "",
        relationships: [],
      }),
    ).toThrow("Relationship sync requested an empty relationship kind.");
  });

  it("rejects an empty requested subject resource kind", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        subjectResourceKind: "",
        relationships: [],
      }),
    ).toThrow("Relationship sync requested an empty subject resource kind.");
  });

  it("rejects an empty requested object resource kind", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        objectResourceKind: "",
        relationships: [],
      }),
    ).toThrow("Relationship sync requested an empty object resource kind.");
  });

  it("rejects an empty requested scope value", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        scope: {
          scopeKind: "user_group",
          scopeHandle: "",
        },
        relationships: [],
      }),
    ).toThrow("Too small: expected string to have >=1 characters");
  });

  it("rejects duplicate relationship keys within a scope", () => {
    const relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship> = [
      slackUserGroupMembership({
        subjectExternalId: "U123",
        subjectHandle: "alice",
        objectExternalId: "S123",
        objectHandle: "engineering",
      }),
      slackUserGroupMembership({
        subjectExternalId: "U123",
        subjectHandle: "alice",
        objectExternalId: "S123",
        objectHandle: "engineering",
      }),
    ];

    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships,
      }),
    ).toThrow(
      "Provider returned duplicate relationship 'belongs_to' from 'alice' to 'engineering' in scope 'engineering'.",
    );
  });

  it("rejects duplicate relationship handles when one row is enriched with external ids", () => {
    const relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship> = [
      slackUserGroupMembership({
        subjectExternalId: "U123",
        subjectHandle: "alice",
        objectExternalId: "S123",
        objectHandle: "engineering",
      }),
      slackUserGroupMembership({
        subjectHandle: "alice",
        objectHandle: "engineering",
      }),
    ];

    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships,
      }),
    ).toThrow(
      "Provider returned duplicate relationship 'belongs_to' from 'alice' to 'engineering' in scope 'engineering'.",
    );
  });

  it("does not confuse relationship identities that contain delimiters", () => {
    const relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship> = [
      slackUserGroupMembership({
        subjectExternalId: "U:123",
        subjectHandle: "first",
        objectExternalId: "S",
        objectHandle: "one:two",
      }),
      slackUserGroupMembership({
        subjectExternalId: "U",
        subjectHandle: "second",
        objectExternalId: "S:one",
        objectHandle: "two",
      }),
    ];

    expect(
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships,
      }),
    ).toEqual(relationships);
  });

  it("rejects relationship kind mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            relationshipKind: "admin_of",
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectExternalId: "S123",
            objectHandle: "engineering",
          }),
        ],
      }),
    ).toThrow("Provider returned relationship kind 'admin_of' while syncing 'belongs_to'.");
  });

  it("rejects relationship subject resource kind mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectResourceKind: "bot",
            subjectExternalId: "B123",
            subjectHandle: "build-bot",
            objectExternalId: "S123",
            objectHandle: "engineering",
          }),
        ],
      }),
    ).toThrow("Provider returned relationship subject resource kind 'bot' while syncing 'user'.");
  });

  it("rejects relationship object resource kind mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectResourceKind: "workspace",
            objectExternalId: "T123",
            objectHandle: "mistle",
          }),
        ],
      }),
    ).toThrow(
      "Provider returned relationship object resource kind 'workspace' while syncing 'user_group'.",
    );
  });

  it("rejects relationship scope kind mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectExternalId: "S123",
            objectHandle: "engineering",
            scopeKind: "workspace",
          }),
        ],
      }),
    ).toThrow("Provider returned relationship scope kind 'workspace' while syncing 'user_group'.");
  });

  it("rejects relationship scope external id mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectExternalId: "S123",
            objectHandle: "engineering",
            scopeExternalId: "S456",
          }),
        ],
      }),
    ).toThrow("Provider returned relationship scope external id 'S456' while syncing 'S123'.");
  });

  it("rejects relationship scope handle mismatches", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          slackUserGroupMembership({
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectExternalId: "S123",
            objectHandle: "engineering",
            scopeHandle: "support",
          }),
        ],
      }),
    ).toThrow("Provider returned relationship scope handle 'support' while syncing 'engineering'.");
  });

  it("rejects an omitted relationship scope external id when the request has one", () => {
    expect(() =>
      validateDiscoveredResourceRelationships({
        ...SlackUserGroupMembershipRequest,
        relationships: [
          {
            relationshipKind: "belongs_to",
            subjectResourceKind: "user",
            subjectExternalId: "U123",
            subjectHandle: "alice",
            objectResourceKind: "user_group",
            objectExternalId: "S123",
            objectHandle: "engineering",
            scopeKind: "user_group",
            scopeHandle: "engineering",
            metadata: {},
          },
        ],
      }),
    ).toThrow("Provider returned relationship scope external id '<none>' while syncing 'S123'.");
  });
});

function slackUserGroupMembership(input: {
  relationshipKind?: string;
  subjectResourceKind?: string;
  subjectExternalId?: string;
  subjectHandle: string;
  objectResourceKind?: string;
  objectExternalId?: string;
  objectHandle: string;
  scopeKind?: string;
  scopeExternalId?: string;
  scopeHandle?: string;
  metadata?: Record<string, unknown>;
}): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: input.relationshipKind ?? "belongs_to",
    subjectResourceKind: input.subjectResourceKind ?? "user",
    ...(input.subjectExternalId === undefined
      ? {}
      : { subjectExternalId: input.subjectExternalId }),
    subjectHandle: input.subjectHandle,
    objectResourceKind: input.objectResourceKind ?? "user_group",
    ...(input.objectExternalId === undefined ? {} : { objectExternalId: input.objectExternalId }),
    objectHandle: input.objectHandle,
    scopeKind: input.scopeKind ?? "user_group",
    scopeExternalId: input.scopeExternalId ?? "S123",
    scopeHandle: input.scopeHandle ?? "engineering",
    metadata: input.metadata ?? {},
  };
}
