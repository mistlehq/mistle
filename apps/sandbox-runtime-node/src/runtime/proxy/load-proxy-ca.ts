import { readFileSync } from "node:fs";

import type { RuntimeConfig } from "../config.js";
import { createCertificateAuthority, type CertificateAuthority } from "./certificate-authority.js";

function readInheritedFd(fd: number, envName: string): string {
  let payload: string;
  try {
    payload = readFileSync(fd, "utf8");
  } catch (error) {
    throw new Error(
      `failed to read ${envName} payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (payload.length === 0) {
    throw new Error(`${envName} payload must not be empty`);
  }

  return payload;
}

export function loadProxyCertificateAuthority(
  config: RuntimeConfig,
): CertificateAuthority | undefined {
  if (!config.proxyCaConfigured) {
    return undefined;
  }

  const certificatePem = readInheritedFd(config.proxyCaCertFd, "SANDBOX_RUNTIME_PROXY_CA_CERT_FD");
  const privateKeyPem = readInheritedFd(config.proxyCaKeyFd, "SANDBOX_RUNTIME_PROXY_CA_KEY_FD");

  try {
    return createCertificateAuthority(certificatePem, privateKeyPem);
  } catch (error) {
    throw new Error(
      `failed to load proxy certificate authority: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
