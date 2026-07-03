import { type ControlPlaneDatabase, type ControlPlaneTransaction } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import { resolveTriggerTargetSandboxProfileVersion } from "../../triggers/services/trigger-target-profile-version.js";
import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export async function resolveSandboxProfileTriggerReferenceOrThrow(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | undefined;
    integrationConnectionId: string;
  },
): Promise<number> {
  const sandboxProfileVersion =
    input.sandboxProfileVersion ??
    (await resolveDefaultSandboxProfileTriggerVersionOrThrow(ctx, {
      sandboxProfileId: input.sandboxProfileId,
    }));

  const binding = await ctx.db.query.sandboxProfileVersionIntegrationBindings.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.sandboxProfileVersion, sandboxProfileVersion),
        eq(table.connectionId, input.integrationConnectionId),
      ),
  });

  if (binding === undefined) {
    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      "Sandbox profile must bind the selected integration connection to use its webhook triggers.",
    );
  }

  return sandboxProfileVersion;
}

async function resolveDefaultSandboxProfileTriggerVersionOrThrow(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    sandboxProfileId: string;
  },
): Promise<number> {
  const profile = await ctx.db.query.sandboxProfiles.findFirst({
    columns: {
      activeVersion: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxProfileId),
  });

  if (profile === undefined) {
    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      "Sandbox profile must bind the selected integration connection to use its webhook triggers.",
    );
  }

  return resolveTriggerTargetSandboxProfileVersion({
    activeVersion: profile.activeVersion,
  });
}
