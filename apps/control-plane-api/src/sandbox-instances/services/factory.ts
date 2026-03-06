import { getInstance } from "./get-instance.js";
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
