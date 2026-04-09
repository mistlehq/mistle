export function resolveOrganizationSwitcherErrorMessage(input: {
  organizationOptionsError: unknown;
  switchOrganizationError: string | null;
}): string | null {
  if (input.switchOrganizationError !== null) {
    return input.switchOrganizationError;
  }

  if (input.organizationOptionsError instanceof Error) {
    return input.organizationOptionsError.message;
  }

  return null;
}
