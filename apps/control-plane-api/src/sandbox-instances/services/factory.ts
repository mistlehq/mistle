import { getInstance } from "./get-instance.js";
import { listInstances } from "./list-instances.js";
import { mintConnectionToken } from "./mint-connection-token.js";
import type { CreateSandboxInstancesServiceInput, SandboxInstancesService } from "./types.js";

export type { CreateSandboxInstancesServiceInput, SandboxInstancesService } from "./types.js";
export {
  SandboxInstancesBadRequestCodes,
  SandboxInstancesBadRequestError,
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "./errors.js";

export function createSandboxInstancesService(
  input: CreateSandboxInstancesServiceInput,
): SandboxInstancesService {
  const sandboxInstancesService = {
    listInstances: (serviceInput) => listInstances(input.db, input.dataPlaneClient, serviceInput),
    getInstance: (serviceInput) => getInstance(input.dataPlaneClient, serviceInput),
    mintConnectionToken: (serviceInput) => mintConnectionToken(input.dataPlaneClient, serviceInput),
    mintConnectionTokenForInstance: (serviceInput) =>
      mintConnectionToken(input.dataPlaneClient, {
        ...serviceInput,
        gatewayWebsocketUrl: input.defaultConnectionToken.gatewayWebsocketUrl,
        tokenTtlSeconds: input.defaultConnectionToken.tokenTtlSeconds,
        tokenConfig: input.defaultConnectionToken.tokenConfig,
      }),
  } satisfies SandboxInstancesService;

  return sandboxInstancesService;
}
