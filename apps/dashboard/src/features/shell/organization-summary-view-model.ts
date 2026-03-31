export type OrganizationSummaryViewModel = {
  organizationName: string;
  organizationLogoUrl: string | null;
  organizationErrorMessage: string | null;
};

export function resolveOrganizationSummaryViewModel(input: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  organizationName: string | null;
  organizationLogoUrl: string | null;
}): OrganizationSummaryViewModel {
  if (input.isPending) {
    return {
      organizationName: "",
      organizationLogoUrl: null,
      organizationErrorMessage: null,
    };
  }

  if (input.isError) {
    const message =
      input.error instanceof Error && input.error.message.trim().length > 0
        ? input.error.message
        : "Could not load organization.";
    return {
      organizationName: "Organization unavailable",
      organizationLogoUrl: null,
      organizationErrorMessage: message,
    };
  }

  return {
    organizationName: input.organizationName ?? "Organization unavailable",
    organizationLogoUrl: input.organizationLogoUrl,
    organizationErrorMessage: null,
  };
}
