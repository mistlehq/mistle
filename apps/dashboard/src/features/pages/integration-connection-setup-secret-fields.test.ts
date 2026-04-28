import { describe, expect, it } from "vitest";

import {
  hasConfiguredSetupSecretField,
  resolveConfiguredSetupSecretFieldKeys,
} from "./integration-connection-setup-secret-fields.js";

describe("hasConfiguredSetupSecretField", () => {
  it("returns whether the connection has a configured secret field", () => {
    expect(
      hasConfiguredSetupSecretField({
        configuredSecretNames: ["botToken", "signingSecret"],
        fieldName: "botToken",
      }),
    ).toBe(true);

    expect(
      hasConfiguredSetupSecretField({
        configuredSecretNames: ["botToken"],
        fieldName: "signingSecret",
      }),
    ).toBe(false);
  });
});

describe("resolveConfiguredSetupSecretFieldKeys", () => {
  it("returns configured secret keys constrained to known setup fields", () => {
    expect(
      resolveConfiguredSetupSecretFieldKeys({
        configuredSecretNames: ["botToken", "unknownSecret", "signingSecret"],
        fieldKeys: ["botToken", "signingSecret", "clientSecret"],
      }),
    ).toEqual(new Set(["botToken", "signingSecret"]));
  });
});
