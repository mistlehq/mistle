export type OrganizationSummaryViewModel = {
  organizationName: string;
  organizationErrorMessage: string | null;
};

export function resolveOrganizationSummaryViewModel(input: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  organizationName: string | null;
}): OrganizationSummaryViewModel {
  if (input.isPending) {
    return {
      organizationName: "",
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
      organizationErrorMessage: message,
    };
  }

  return {
    organizationName: input.organizationName ?? "Organization unavailable",
    organizationErrorMessage: null,
  };
}
