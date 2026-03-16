import { createSecureContext, type SecureContext } from "node:tls";

import { issueProxyLeafCertificate } from "@mistle/sandbox-rs-napi";

function normalizeCertificateHost(serverName: string): string {
  const trimmedServerName = serverName.trim().toLowerCase();
  if (trimmedServerName.length === 0) {
    return trimmedServerName;
  }

  if (trimmedServerName.startsWith("[")) {
    const endBracketIndex = trimmedServerName.indexOf("]");
    if (endBracketIndex >= 0) {
      return trimmedServerName.slice(1, endBracketIndex);
    }
  }

  const separatorIndex = trimmedServerName.lastIndexOf(":");
  if (separatorIndex > 0) {
    const host = trimmedServerName.slice(0, separatorIndex);
    const port = trimmedServerName.slice(separatorIndex + 1);
    if (port.length > 0 && Number.isInteger(Number(port))) {
      return host;
    }
  }

  return trimmedServerName;
}

export type CertificateAuthority = {
  secureContextForTarget(connectTarget: string): SecureContext;
};

export function createCertificateAuthority(
  certificatePem: string,
  privateKeyPem: string,
): CertificateAuthority {
  if (certificatePem.trim().length === 0) {
    throw new Error("proxy ca certificate pem is invalid");
  }

  if (privateKeyPem.trim().length === 0) {
    throw new Error("proxy ca private key pem is invalid");
  }

  const contextCache = new Map<string, SecureContext>();

  return {
    secureContextForTarget(connectTarget) {
      const cacheKey = normalizeCertificateHost(connectTarget);
      if (cacheKey.length === 0) {
        throw new Error("connect target is required");
      }

      const cachedContext = contextCache.get(cacheKey);
      if (cachedContext !== undefined) {
        return cachedContext;
      }

      const leafCertificate = issueProxyLeafCertificate({
        caCertificatePem: certificatePem,
        caPrivateKeyPem: privateKeyPem,
        serverName: cacheKey,
      });

      const secureContext = createSecureContext({
        cert: leafCertificate.certificateChainPem,
        key: leafCertificate.privateKeyPem,
        minVersion: "TLSv1.2",
      });
      contextCache.set(cacheKey, secureContext);
      return secureContext;
    },
  };
}
