import { describe, expect, it } from "vitest";

import {
  createOrganizationCreateSlug,
  resolveOrganizationOnboardingValidation,
} from "./organization-onboarding.js";

describe("resolveOrganizationOnboardingValidation", () => {
  it("requires organization name", () => {
    expect(
      resolveOrganizationOnboardingValidation({
        name: " ",
      }),
    ).toEqual({
      nameError: "Organization name is required.",
    });
  });

  it("accepts a valid organization name", () => {
    expect(
      resolveOrganizationOnboardingValidation({
        name: "Acme",
      }),
    ).toEqual({
      nameError: null,
    });
  });
});

describe("createOrganizationCreateSlug", () => {
  it("returns an internal slug token", () => {
    expect(createOrganizationCreateSlug()).toMatch(/^org-[0-9a-f-]{36}$/u);
  });
});
