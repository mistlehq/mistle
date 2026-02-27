import type { CreateSandboxProfilesServiceInput, SandboxProfilesService } from "./types.js";

import { createProfile } from "./create-profile.js";
import { getProfile } from "./get-profile.js";
import { listProfiles } from "./list-profiles.js";
import { requestDeleteProfile } from "./request-delete-profile.js";
import { startProfileInstance } from "./start-profile-instance.js";
import { updateProfile } from "./update-profile.js";

export type { CreateSandboxProfilesServiceInput, SandboxProfilesService } from "./types.js";
export {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "./errors.js";

export function createSandboxProfilesService(
  input: CreateSandboxProfilesServiceInput,
): SandboxProfilesService {
  const sandboxProfilesService = {
    listProfiles: (serviceInput) => listProfiles({ db: input.db }, serviceInput),
    createProfile: (serviceInput) => createProfile({ db: input.db }, serviceInput),
    getProfile: (serviceInput) => getProfile({ db: input.db }, serviceInput),
    updateProfile: (serviceInput) => updateProfile({ db: input.db }, serviceInput),
    requestDeleteProfile: (serviceInput) =>
      requestDeleteProfile(
        {
          db: input.db,
          openWorkflow: input.openWorkflow,
        },
        serviceInput,
      ),
    startProfileInstance: (serviceInput) =>
      startProfileInstance(
        {
          db: input.db,
          openWorkflow: input.openWorkflow,
          resolveSandboxProfileVersionImage: input.resolveSandboxProfileVersionImage,
        },
        serviceInput,
      ),
  } satisfies SandboxProfilesService;

  return sandboxProfilesService;
}
