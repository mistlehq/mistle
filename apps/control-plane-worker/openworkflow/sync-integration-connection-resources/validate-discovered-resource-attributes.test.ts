import type {
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceAttribute,
  IntegrationResourceAttributeDefinition,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { validateDiscoveredResourceAttributes } from "./validate-discovered-resource-attributes.js";

const SlackUserAttributeDefinitions: ReadonlyArray<IntegrationResourceAttributeDefinition> = [
  {
    key: "is_bot",
    valueType: "boolean",
    actorPolicyEligible: true,
  },
  {
    key: "timezone_offset",
    valueType: "number",
  },
  {
    key: "display_type",
    valueType: "string",
  },
];

const SlackUserResources: ReadonlyArray<DiscoveredIntegrationResource> = [
  {
    externalId: "U123",
    handle: "alice",
    displayName: "Alice",
    metadata: {},
  },
  {
    externalId: "U456",
    handle: "bot",
    displayName: "Bot",
    metadata: {},
  },
];

describe("validateDiscoveredResourceAttributes", () => {
  it("accepts omitted attributes when the provider has not declared resource attributes", () => {
    expect(
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
      }),
    ).toEqual([]);
  });

  it("accepts declared canonical attributes for resources in the synced snapshot", () => {
    const attributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute> = [
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "is_bot",
        value: "false",
        valueType: "boolean",
      }),
      slackUserAttribute({
        resourceExternalId: "U456",
        resourceHandle: "bot",
        key: "is_bot",
        value: "true",
        valueType: "boolean",
      }),
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "timezone_offset",
        value: "-28800",
        valueType: "number",
      }),
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "display_type",
        value: "human",
        valueType: "string",
      }),
    ];

    expect(
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes,
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toEqual(attributes);
  });

  it("rejects duplicate attributes for the same resource and key", () => {
    const attributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute> = [
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "is_bot",
        value: "false",
        valueType: "boolean",
      }),
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "is_bot",
        value: "true",
        valueType: "boolean",
      }),
      slackUserAttribute({
        resourceExternalId: "U456",
        resourceHandle: "bot",
        key: "is_bot",
        value: "true",
        valueType: "boolean",
      }),
    ];

    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes,
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Provider returned duplicate attribute 'is_bot' for resource 'alice'.");
  });

  it("does not confuse resource ids and attribute keys that contain delimiters", () => {
    const resources: ReadonlyArray<DiscoveredIntegrationResource> = [
      {
        externalId: "x:y",
        handle: "first",
        displayName: "First",
        metadata: {},
      },
      {
        externalId: "x",
        handle: "second",
        displayName: "Second",
        metadata: {},
      },
    ];
    const attributeDefinitions: ReadonlyArray<IntegrationResourceAttributeDefinition> = [
      {
        key: "z",
        valueType: "string",
      },
      {
        key: "y:z",
        valueType: "string",
      },
    ];
    const attributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute> = [
      slackUserAttribute({
        resourceExternalId: "x:y",
        resourceHandle: "first",
        key: "z",
        value: "present",
        valueType: "string",
      }),
      slackUserAttribute({
        resourceExternalId: "x",
        resourceHandle: "second",
        key: "y:z",
        value: "present",
        valueType: "string",
      }),
    ];

    expect(
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources,
        attributes,
        attributeDefinitions,
      }),
    ).toEqual(attributes);
  });

  it("rejects missing actor-policy attributes for any resource in the snapshot", () => {
    const attributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute> = [
      slackUserAttribute({
        resourceExternalId: "U123",
        resourceHandle: "alice",
        key: "is_bot",
        value: "false",
        valueType: "boolean",
      }),
    ];

    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes,
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Provider omitted actor-policy attribute 'is_bot' for resource 'bot'.");
  });

  it("rejects attributes for resources outside the synced snapshot", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          slackUserAttribute({
            resourceExternalId: "U789",
            resourceHandle: "unknown",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
          }),
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Provider returned attribute 'is_bot' for unknown resource 'unknown'.");
  });

  it("rejects attributes whose stable resource id and handle disagree", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          slackUserAttribute({
            resourceExternalId: "U123",
            resourceHandle: "renamed-alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
          }),
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow(
      "Provider returned attribute 'is_bot' for external resource 'U123' with mismatched handle 'renamed-alice'.",
    );
  });

  it("rejects undeclared attributes", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          slackUserAttribute({
            resourceExternalId: "U123",
            resourceHandle: "alice",
            key: "is_admin",
            value: "true",
            valueType: "boolean",
          }),
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Provider returned undeclared attribute 'is_admin' for resource kind 'user'.");
  });

  it("rejects attributes for a different resource kind than the active sync", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          {
            resourceKind: "channel",
            resourceExternalId: "U123",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          },
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow(
      "Provider returned attribute 'is_bot' for resource kind 'channel' while syncing 'user'.",
    );
  });

  it("rejects non-canonical boolean and number values", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          slackUserAttribute({
            resourceExternalId: "U123",
            resourceHandle: "alice",
            key: "is_bot",
            value: "False",
            valueType: "boolean",
          }),
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Provider returned boolean attribute 'is_bot' with non-canonical value 'False'.");

    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          slackUserAttribute({
            resourceExternalId: "U123",
            resourceHandle: "alice",
            key: "timezone_offset",
            value: "01",
            valueType: "number",
          }),
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow(
      "Provider returned number attribute 'timezone_offset' with non-canonical value '01'.",
    );
  });

  it("rejects empty structural attribute fields", () => {
    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          {
            resourceKind: "user",
            resourceHandle: "",
            key: "display_type",
            value: "human",
            valueType: "string",
            metadata: {},
          },
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Too small");

    expect(() =>
      validateDiscoveredResourceAttributes({
        resourceKind: "user",
        resources: SlackUserResources,
        attributes: [
          {
            resourceKind: "user",
            resourceHandle: "alice",
            key: "display_type",
            value: "",
            valueType: "string",
            metadata: {},
          },
        ],
        attributeDefinitions: SlackUserAttributeDefinitions,
      }),
    ).toThrow("Too small");
  });
});

function slackUserAttribute(input: {
  resourceExternalId: string;
  resourceHandle: string;
  key: string;
  value: string;
  valueType: "boolean" | "number" | "string";
}): DiscoveredIntegrationResourceAttribute {
  return {
    resourceKind: "user",
    resourceExternalId: input.resourceExternalId,
    resourceHandle: input.resourceHandle,
    key: input.key,
    value: input.value,
    valueType: input.valueType,
    metadata: {},
  };
}
