import { describe, expect, it } from "vitest";

import {
  buildIntegrationCards,
  deriveIntegrationStatus,
  resolveIntegrationDisplayName,
} from "./directory-model.js";
import type { IntegrationConnection, IntegrationTarget } from "./integrations-service.js";

function createTarget(input: {
  targetKey: string;
  familyId: string;
  variantId: string;
  displayNameOverride?: string;
}): IntegrationTarget {
  return {
    targetKey: input.targetKey,
    familyId: input.familyId,
    variantId: input.variantId,
    enabled: true,
    config: {},
    ...(input.displayNameOverride === undefined
      ? {}
      : { displayNameOverride: input.displayNameOverride }),
  };
}

function createConnection(input: {
  id: string;
  targetKey: string;
  status: IntegrationConnection["status"];
}): IntegrationConnection {
  return {
    id: input.id,
    targetKey: input.targetKey,
    status: input.status,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z",
  };
}

describe("integrations directory model", () => {
  it("resolves display names with known family normalization and explicit overrides", () => {
    expect(
      resolveIntegrationDisplayName(
        createTarget({
          targetKey: "github-cloud",
          familyId: "github",
          variantId: "github-cloud",
        }),
      ),
    ).toBe("GitHub");

    expect(
      resolveIntegrationDisplayName(
        createTarget({
          targetKey: "custom-v2",
          familyId: "custom_provider",
          variantId: "custom-v2",
          displayNameOverride: "Custom Integration",
        }),
      ),
    ).toBe("Custom Integration");
  });

  it("derives connection status with active > error > not connected priority", () => {
    expect(
      deriveIntegrationStatus([
        createConnection({ id: "icn_1", targetKey: "openai-default", status: "error" }),
        createConnection({ id: "icn_2", targetKey: "openai-default", status: "active" }),
      ]),
    ).toBe("Connected");

    expect(
      deriveIntegrationStatus([
        createConnection({ id: "icn_3", targetKey: "openai-default", status: "error" }),
      ]),
    ).toBe("Error");

    expect(deriveIntegrationStatus([])).toBe("Not connected");
  });

  it("throws when connections reference target keys that are not present in target discovery", () => {
    expect(() =>
      buildIntegrationCards({
        targets: [
          createTarget({
            targetKey: "openai-default",
            familyId: "openai",
            variantId: "openai-default",
          }),
        ],
        connections: [
          createConnection({ id: "icn_1", targetKey: "missing-target", status: "active" }),
        ],
      }),
    ).toThrow("Integration target metadata is missing for connected target keys: missing-target");
  });
});
