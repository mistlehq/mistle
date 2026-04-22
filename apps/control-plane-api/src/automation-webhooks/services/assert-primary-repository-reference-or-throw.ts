import { BadRequestError } from "@mistle/http/errors.js";

import { listProfileVersionRepositoryOptions } from "../../sandbox-profiles/services/repository-options.js";
import { AutomationWebhooksBadRequestCodes } from "../constants.js";

export async function assertPrimaryRepositoryReferenceOrThrow(
  ctx: {
    db: Parameters<typeof listProfileVersionRepositoryOptions>[0]["db"];
  },
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  },
): Promise<void> {
  if (input.primaryRepositoryId === null) {
    return;
  }

  const repositoryOptions = await listProfileVersionRepositoryOptions(
    {
      db: ctx.db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.sandboxProfileId,
      profileVersion: input.sandboxProfileVersion,
    },
  );

  const matchingRepository = repositoryOptions.find(
    (option) => option.id === input.primaryRepositoryId,
  );
  if (matchingRepository !== undefined) {
    return;
  }

  throw new BadRequestError(
    AutomationWebhooksBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    `Primary repository '${input.primaryRepositoryId}' is not available for sandbox profile '${input.sandboxProfileId}' version ${String(input.sandboxProfileVersion)}.`,
  );
}
