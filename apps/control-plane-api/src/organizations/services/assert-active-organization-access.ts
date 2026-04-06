import { ForbiddenError } from "@mistle/http/errors.js";

export function assertActiveOrganizationAccess(input: {
  activeOrganizationId: string;
  organizationId: string;
}): void {
  if (input.organizationId !== input.activeOrganizationId) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
