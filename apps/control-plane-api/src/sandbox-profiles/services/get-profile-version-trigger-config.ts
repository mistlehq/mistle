import {
  getProfileVersionIntegrationBindings,
  type GetProfileVersionIntegrationBindingsInput,
} from "./get-profile-version-integration-bindings.js";
import type { SandboxProfileRepositoryOption } from "./repository-options.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type GetProfileVersionTriggerConfigOutput = {
  bindings: Awaited<ReturnType<typeof getProfileVersionIntegrationBindings>>["bindings"];
  repositoryOptions: SandboxProfileRepositoryOption[];
};

export async function getProfileVersionTriggerConfig(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: GetProfileVersionIntegrationBindingsInput,
): Promise<GetProfileVersionTriggerConfigOutput> {
  const [{ bindings }, repositoryOptions] = await Promise.all([
    getProfileVersionIntegrationBindings(
      {
        db,
      },
      input,
    ),
    listProfileVersionRepositoryOptions(
      {
        db,
      },
      {
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
      },
    ),
  ]);

  return {
    bindings,
    repositoryOptions,
  };
}
