type RequireAuthViewState =
  | "loading"
  | "error"
  | "unauthenticated"
  | "missing-organization"
  | "authenticated";

export function resolveRequireAuthViewState(input: {
  isLoading: boolean;
  errorMessage: string | null;
  hasSession: boolean;
  hasActiveOrganization: boolean;
}): RequireAuthViewState {
  if (input.isLoading) {
    return "loading";
  }

  if (input.errorMessage !== null) {
    return "error";
  }

  if (!input.hasSession) {
    return "unauthenticated";
  }

  if (!input.hasActiveOrganization) {
    return "missing-organization";
  }

  return "authenticated";
}
