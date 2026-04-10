import { describe, expect, it } from "vitest";

import {
  PlanetScaleConnectionConfigSchema,
  resolvePlanetScaleCredentialSecretType,
  resolvePlanetScaleCredentialSlotKeys,
} from "./auth.js";

describe("PlanetScale auth", () => {
  it("parses the oauth2-authorization-code connection method", () => {
    expect(
      PlanetScaleConnectionConfigSchema.parse({
        connection_method: "oauth2-authorization-code",
      }),
    ).toEqual({
      connection_method: "oauth2-authorization-code",
    });
  });

  it("resolves the PlanetScale OAuth access-token secret type", () => {
    expect(
      resolvePlanetScaleCredentialSecretType({
        connection_method: "oauth2-authorization-code",
      }),
    ).toBe("oauth2_access_token");
  });

  it("derives the managed OAuth credential slot keys", () => {
    expect(
      resolvePlanetScaleCredentialSlotKeys({
        familyId: "planetscale",
        variantId: "planetscale-default",
      }),
    ).toEqual({
      accessToken: "planetscale.planetscale-default.oauth2-authorization-code.access-token",
      refreshToken: "planetscale.planetscale-default.oauth2-authorization-code.refresh-token",
    });
  });
});
