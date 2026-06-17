import { ForbiddenError } from "@mistle/http/errors.js";

import type { AppOrganizationActor } from "../types.js";

export type DesignerOrganizationActor = Extract<AppOrganizationActor, { kind: "oauth" | "user" }>;

export function requireDesignerOrganizationActor(
  organizationActor: AppOrganizationActor,
): DesignerOrganizationActor {
  if (organizationActor.kind === "user" || organizationActor.kind === "oauth") {
    return organizationActor;
  }

  throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
}
