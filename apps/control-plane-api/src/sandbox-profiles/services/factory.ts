import { compileProfileVersionRuntimePlan } from "./compile-profile-version-runtime-plan.js";
import { createProfile } from "./create-profile.js";
import { getProfile } from "./get-profile.js";
import { listProfiles } from "./list-profiles.js";
import { putProfileVersionIntegrationBindings } from "./put-profile-version-integration-bindings.js";
import { requestDeleteProfile } from "./request-delete-profile.js";
import { startProfileInstance } from "./start-profile-instance.js";
import type { CreateSandboxProfilesServiceInput, SandboxProfilesService } from "./types.js";
import { updateProfile } from "./update-profile.js";

export type { CreateSandboxProfilesServiceInput, SandboxProfilesService } from "./types.js";
export {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
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
    putProfileVersionIntegrationBindings: (serviceInput) =>
      putProfileVersionIntegrationBindings(
        {
          db: input.db,
        },
        serviceInput,
      ),
    startProfileInstance: (serviceInput) =>
      startProfileInstance(
        {
          db: input.db,
          dataPlaneDb: input.dataPlaneDb,
          openWorkflow: input.openWorkflow,
        },
        serviceInput,
      ),
    compileProfileVersionRuntimePlan: (serviceInput) =>
      compileProfileVersionRuntimePlan(
        {
          db: input.db,
        },
        serviceInput,
      ),
  } satisfies SandboxProfilesService;

  return sandboxProfilesService;
}
