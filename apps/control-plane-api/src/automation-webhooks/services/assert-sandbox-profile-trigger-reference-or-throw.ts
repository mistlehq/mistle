import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  IntegrationBindingKinds,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";

export async function assertSandboxProfileTriggerReferenceOrThrow(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | null | undefined;
    integrationConnectionId: string;
  },
): Promise<void> {
  const sandboxProfileVersion =
    input.sandboxProfileVersion ??
    (
      await ctx.db.query.sandboxProfileVersions.findFirst({
        columns: {
          version: true,
        },
        where: (table, { eq }) => eq(table.sandboxProfileId, input.sandboxProfileId),
        orderBy: (table, { desc }) => [desc(table.version)],
      })
    )?.version;

  if (sandboxProfileVersion === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      "Sandbox profile must bind the selected integration connection to use its automation triggers.",
    );
  }

  const binding = await ctx.db.query.sandboxProfileVersionIntegrationBindings.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.sandboxProfileVersion, sandboxProfileVersion),
        eq(table.connectionId, input.integrationConnectionId),
        eq(table.kind, IntegrationBindingKinds.CONNECTOR),
      ),
  });

  if (binding === undefined) {
    throw new BadRequestError(
      AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      "Sandbox profile must bind the selected integration connection to use its automation triggers.",
    );
  }
}
