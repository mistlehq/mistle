import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { ProxyCaCertFdEnv, ProxyCaKeyFdEnv } from "../runtime/config.js";
import { ProxyCaCertInstallPath } from "./config.js";

export const UpdateCaCertificatesPath = "/usr/sbin/update-ca-certificates";

export type GeneratedProxyCa = ReturnType<typeof generateProxyCa>;

function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // ignore close errors during cleanup
  }
}

function writeTempFd(payload: string, fileName: string): number {
  const tempDirectory = mkdtempSync(join(tmpdir(), "mistle-proxy-ca-"));
  const filePath = join(tempDirectory, fileName);
  writeFileSync(filePath, payload, { mode: 0o600 });
  const fd = openSync(filePath, "r");
  unlinkSync(filePath);
  rmSync(tempDirectory, { recursive: true, force: true });
  return fd;
}

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
  const certFd = writeTempFd(proxyCa.certificatePem, "proxy-ca-cert.pem");
  const keyFd = writeTempFd(proxyCa.privateKeyPem, "proxy-ca-key.pem");

  return {
    env: {
      [ProxyCaCertFdEnv]: String(certFd),
      [ProxyCaKeyFdEnv]: String(keyFd),
    },
    cleanup: () => {
      closeFd(certFd);
      closeFd(keyFd);
    },
  };
}
