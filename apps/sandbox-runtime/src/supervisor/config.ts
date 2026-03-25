import { join } from "node:path";

const DefaultControlDirectoryPath = "/run/mistle";
const ControlDirectoryEnv = "SANDBOX_RUNTIME_CONTROL_DIR";
const SocketFileName = "startup-config.sock";
const TokenFileName = "startup-config.token";

type LookupEnv = (key: string) => string | undefined;

export type SupervisorConfig = {
  controlDirectoryPath: string;
  socketPath: string;
  tokenPath: string;
};

function normalizeOptionalPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

export function loadSupervisorConfig(lookupEnv: LookupEnv): SupervisorConfig {
  const controlDirectoryPath =
    normalizeOptionalPath(lookupEnv(ControlDirectoryEnv)) ?? DefaultControlDirectoryPath;

  return {
    controlDirectoryPath,
    socketPath: join(controlDirectoryPath, SocketFileName),
    tokenPath: join(controlDirectoryPath, TokenFileName),
  };
}
