import { RequestDeleteSandboxProfileWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type RequestDeleteProfileInput = {
  organizationId: string;
  profileId: string;
};

type RequestDeleteProfileOutput = {
  profileId: string;
};

export async function requestDeleteProfile(
  { db, openWorkflow }: Pick<CreateSandboxProfilesServiceInput, "db" | "openWorkflow">,
  serviceInput: RequestDeleteProfileInput,
): Promise<RequestDeleteProfileOutput> {
  const profile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, serviceInput.profileId),
        eq(table.organizationId, serviceInput.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  await openWorkflow.runWorkflow(RequestDeleteSandboxProfileWorkflowSpec, {
    organizationId: serviceInput.organizationId,
    profileId: serviceInput.profileId,
  });

  return {
    profileId: serviceInput.profileId,
  };
}
