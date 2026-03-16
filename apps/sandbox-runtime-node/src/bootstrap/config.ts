export const DefaultSandboxUser = "sandbox";
export const SandboxUserEnv = "SANDBOX_USER";
export const ProxyCaCertInstallPath = "/usr/local/share/ca-certificates/mistle-proxy-ca.crt";

type LookupEnv = (key: string) => string | undefined;

export type BootstrapConfig = {
  sandboxUser: string;
};

export function loadBootstrapConfig(lookupEnv: LookupEnv): BootstrapConfig {
  const rawSandboxUser = lookupEnv(SandboxUserEnv);
  if (rawSandboxUser === undefined) {
    return {
      sandboxUser: DefaultSandboxUser,
    };
  }

  const trimmedSandboxUser = rawSandboxUser.trim();
  if (trimmedSandboxUser.length === 0) {
    throw new Error(`${SandboxUserEnv} must not be empty when set`);
  }

  if (trimmedSandboxUser !== DefaultSandboxUser) {
    throw new Error(`${SandboxUserEnv} is reserved and must be "${DefaultSandboxUser}"`);
  }

  return {
    sandboxUser: trimmedSandboxUser,
  };
}
