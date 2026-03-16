export const MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE =
  "No active organization is available in the current session.";

export function resolveActiveOrganizationIdFromSession(session: unknown): string | null {
  if (typeof session !== "object" || session === null || !("session" in session)) {
    return null;
  }

  const nestedSession = session.session;
  if (
    typeof nestedSession !== "object" ||
    nestedSession === null ||
    !("activeOrganizationId" in nestedSession)
  ) {
    return null;
  }

  const activeOrganizationId = nestedSession.activeOrganizationId;
  if (typeof activeOrganizationId !== "string" || activeOrganizationId.length === 0) {
    return null;
  }

  return activeOrganizationId;
}

export function requireActiveOrganizationId(organizationId: string | null): string {
  if (organizationId === null) {
    throw new Error(MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE);
  }

  return organizationId;
}
