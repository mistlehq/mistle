import type {
  StartSandboxProfileInstanceServiceDependencies,
  StartSandboxProfileInstanceServiceInput,
  StartSandboxProfileInstanceServiceOutput,
} from "./types.js";
import { verifySandboxProfileVersionExists } from "./verify-sandbox-profile-version-exists.js";

export async function startSandboxProfileInstance(
  deps: StartSandboxProfileInstanceServiceDependencies,
  input: StartSandboxProfileInstanceServiceInput,
): Promise<StartSandboxProfileInstanceServiceOutput> {
  await verifySandboxProfileVersionExists({
    db: deps.db,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
  });

  return deps.dataPlaneSandboxInstancesClient.startSandboxInstance(input);
}
