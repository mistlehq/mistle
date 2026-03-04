import { describe, expect, it } from "vitest";

import {
  createOrganizationCreateSlug,
  resolveOrganizationOnboardingNameError,
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

describe("resolveOrganizationOnboardingNameError", () => {
  it("hides the name error before interaction", () => {
    expect(
      resolveOrganizationOnboardingNameError({
        hasAttemptedSubmit: false,
        nameError: "Organization name is required.",
      }),
    ).toBeNull();
  });

  it("shows the name error after submit is attempted", () => {
    expect(
      resolveOrganizationOnboardingNameError({
        hasAttemptedSubmit: true,
        nameError: "Organization name is required.",
      }),
    ).toBe("Organization name is required.");
  });
});

describe("createOrganizationCreateSlug", () => {
  it("returns an internal slug token", () => {
    expect(createOrganizationCreateSlug()).toMatch(/^org-[0-9a-f-]{36}$/u);
  });
});
