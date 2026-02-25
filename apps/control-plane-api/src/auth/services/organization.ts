/**
 * Builds a human-readable default organization name from a user's display name.
 */
export function buildOrganizationName(userName: string): string {
  const trimmedName = userName.trim();

  if (trimmedName.length === 0) {
    return "Default Organization";
  }

  return `${trimmedName}'s organization`;
}
