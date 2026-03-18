import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { prepareNativeProxyCaRuntimeEnv } from "../native/proxy-ca-host.js";
import { ProxyCaCertFdEnv, ProxyCaKeyFdEnv } from "../runtime/config.js";
import { ProxyCaCertInstallPath } from "./config.js";

export const UpdateCaCertificatesPath = "/usr/sbin/update-ca-certificates";

export type GeneratedProxyCa = ReturnType<typeof generateProxyCa>;

function runUpdateCaCertificates(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const command = spawn(UpdateCaCertificatesPath, {
      stdio: ["ignore", "inherit", "inherit"],
    });

    command.once("error", reject);
    command.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal === null
            ? `failed to update ca certificates: exited with code ${code ?? "unknown"}`
            : `failed to update ca certificates: exited with signal ${signal}`,
        ),
      );
    });
  });
}

export async function installProxyCaCertificate(certificatePem: string): Promise<void> {
  if (typeof process.geteuid !== "function" || process.geteuid() !== 0) {
    throw new Error("proxy ca certificate reconciliation requires root");
  }
  if (certificatePem.length === 0) {
    throw new Error("proxy ca certificate pem is required");
  }

  writeFileSync(ProxyCaCertInstallPath, certificatePem, {
    mode: 0o644,
  });
  await runUpdateCaCertificates();
}

export function prepareProxyCaRuntimeEnv(proxyCa: GeneratedProxyCa): {
  env: Record<string, string>;
  cleanup: () => void;
} {
  const preparedRuntimeEnv = prepareNativeProxyCaRuntimeEnv(proxyCa);

  return {
    env: {
      [ProxyCaCertFdEnv]: String(preparedRuntimeEnv.certFd),
      [ProxyCaKeyFdEnv]: String(preparedRuntimeEnv.keyFd),
    },
    cleanup: preparedRuntimeEnv.cleanup,
  };
}
