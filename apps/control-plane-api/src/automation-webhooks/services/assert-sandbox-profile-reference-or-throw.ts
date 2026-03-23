import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";

export async function assertSandboxProfileReferenceOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    sandboxProfileId: string;
  },
): Promise<void> {
  const profile = await ctx.db.query.sandboxProfiles.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (profile === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      "Sandbox profile must reference a profile in the active organization.",
    );
  }
}
