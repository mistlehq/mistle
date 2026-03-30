import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { execRuntime } from "./exec-runtime.js";
import { installProxyCaCertificate, prepareProxyCaRuntimeEnv } from "./proxy-ca.js";
import { buildPackagedRuntimeExecInput, buildRuntimeExecInput } from "./runtime-exec-input.js";

const RootRuntimeIdentity = {
  username: "root",
  uid: 0,
  gid: 0,
  homeDir: "/root",
} as const;

type RunBootstrapInput = {
  processArgv: readonly string[];
  runtimeExecTarget:
    | {
        kind: "node-script";
        runtimeEntrypointPath: string;
      }
    | {
        kind: "packaged-binary";
        runtimeExecutablePath: string;
      };
};

export async function runBootstrap(input: RunBootstrapInput): Promise<void> {
  if (typeof process.geteuid !== "function" || process.geteuid() !== 0) {
    throw new Error("sandbox bootstrap must start as root");
  }

  const proxyCa = generateProxyCa();
  await installProxyCaCertificate(proxyCa.certificatePem);
  const proxyCaRuntimeEnv = prepareProxyCaRuntimeEnv(proxyCa);
  try {
    const runtimeExecInput =
      input.runtimeExecTarget.kind === "node-script"
        ? buildRuntimeExecInput({
            processEnv: process.env,
            processArgv: input.processArgv,
            runtimeEntrypointPath: input.runtimeExecTarget.runtimeEntrypointPath,
            targetIdentity: RootRuntimeIdentity,
            additionalEnv: proxyCaRuntimeEnv.env,
          })
        : buildPackagedRuntimeExecInput({
            processEnv: process.env,
            processArgv: input.processArgv,
            runtimeExecutablePath: input.runtimeExecTarget.runtimeExecutablePath,
            targetIdentity: RootRuntimeIdentity,
            additionalEnv: proxyCaRuntimeEnv.env,
          });

    execRuntime(runtimeExecInput);
  } finally {
    proxyCaRuntimeEnv.cleanup();
  }
}
