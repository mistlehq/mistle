import { rootCertificates } from "node:tls";

export function buildDirectEgressTrustedCaCertificates(
  trustedUpstreamCaCertificates: readonly string[] | undefined,
): string[] | undefined {
  if (trustedUpstreamCaCertificates === undefined || trustedUpstreamCaCertificates.length === 0) {
    return undefined;
  }

  return [...rootCertificates, ...trustedUpstreamCaCertificates];
}
