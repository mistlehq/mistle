import { mintConnectionToken } from "./mint-connection-token.js";
import type { CreateSandboxInstancesServiceInput, SandboxInstancesService } from "./types.js";

export type { CreateSandboxInstancesServiceInput, SandboxInstancesService } from "./types.js";
export {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "./errors.js";

export function createSandboxInstancesService(
  input: CreateSandboxInstancesServiceInput,
): SandboxInstancesService {
  const sandboxInstancesService = {
    mintConnectionToken: (serviceInput) => mintConnectionToken(input.dataPlaneDb, serviceInput),
  } satisfies SandboxInstancesService;

  return sandboxInstancesService;
}
