import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { formatLogLine, type LogFields, type LogLevel } from "../runtime/logger.js";
import { execRuntime } from "./exec-runtime.js";
import {
  installProxyCaCertificate,
  prepareProxyCaRuntimeEnv,
  runDirectProxyCaHttpsProbe,
  verifyInstalledProxyCaCertificate,
  verifyProxyCaTrustChain,
} from "./proxy-ca.js";
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

  function logBootstrapEvent(level: LogLevel, event: string, fields?: LogFields): void {
    process.stderr.write(
      formatLogLine({
        timestamp: new Date(),
        level,
        event,
        ...(fields === undefined ? {} : { fields }),
      }),
    );
  }

  const bootstrapStartedAtMs = Date.now();
  try {
    logBootstrapEvent("info", "sandbox_bootstrap_started");
    const proxyCa = generateProxyCa();
    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_install_started");
    const installStartedAtMs = Date.now();
    await installProxyCaCertificate(proxyCa.certificatePem);
    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_install_completed", {
      elapsedMs: Date.now() - installStartedAtMs,
    });

    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_structure_verification_started");
    const structureVerificationStartedAtMs = Date.now();
    await verifyInstalledProxyCaCertificate(proxyCa.certificatePem);
    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_structure_verification_completed", {
      elapsedMs: Date.now() - structureVerificationStartedAtMs,
    });

    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_trust_chain_verification_started");
    const trustChainVerificationStartedAtMs = Date.now();
    await verifyProxyCaTrustChain(proxyCa);
    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_trust_chain_verification_completed", {
      elapsedMs: Date.now() - trustChainVerificationStartedAtMs,
    });

    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_https_probe_started");
    const httpsProbeStartedAtMs = Date.now();
    await runDirectProxyCaHttpsProbe(proxyCa);
    logBootstrapEvent("info", "sandbox_bootstrap_proxy_ca_https_probe_completed", {
      elapsedMs: Date.now() - httpsProbeStartedAtMs,
    });

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

      logBootstrapEvent("info", "sandbox_bootstrap_runtime_exec_started", {
        elapsedMs: Date.now() - bootstrapStartedAtMs,
        runtimeTargetKind: input.runtimeExecTarget.kind,
      });
      execRuntime(runtimeExecInput);
    } finally {
      proxyCaRuntimeEnv.cleanup();
    }
  } catch (error) {
    logBootstrapEvent("error", "sandbox_bootstrap_failed", {
      elapsedMs: Date.now() - bootstrapStartedAtMs,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
