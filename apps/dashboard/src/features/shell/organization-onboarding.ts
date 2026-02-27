export type OrganizationOnboardingValidation = {
  nameError: string | null;
};

export function resolveOrganizationOnboardingValidation(input: {
  name: string;
}): OrganizationOnboardingValidation {
  if (input.name.trim().length === 0) {
    return {
      nameError: "Organization name is required.",
    };
  }

  return {
    nameError: null,
  };
}

export function createOrganizationCreateSlug(): string {
  return `org-${globalThis.crypto.randomUUID()}`;
}
