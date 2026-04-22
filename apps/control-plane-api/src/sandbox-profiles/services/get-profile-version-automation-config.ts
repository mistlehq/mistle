import {
  getProfileVersionIntegrationBindings,
  type GetProfileVersionIntegrationBindingsInput,
} from "./get-profile-version-integration-bindings.js";
import type { SandboxProfileRepositoryOption } from "./repository-options.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type GetProfileVersionAutomationConfigOutput = {
  bindings: Awaited<ReturnType<typeof getProfileVersionIntegrationBindings>>["bindings"];
  repositoryOptions: SandboxProfileRepositoryOption[];
};

export async function getProfileVersionAutomationConfig(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: GetProfileVersionIntegrationBindingsInput,
): Promise<GetProfileVersionAutomationConfigOutput> {
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
