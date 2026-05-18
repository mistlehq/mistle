import { rootCertificates } from "node:tls";

import { describe, expect, it } from "vitest";

import { buildDirectEgressTrustedCaCertificates } from "./direct-egress-trust-store.js";

describe("buildDirectEgressTrustedCaCertificates", () => {
  it("leaves the default Node trust store untouched when no extra CA certificates are configured", () => {
    expect(buildDirectEgressTrustedCaCertificates(undefined)).toBeUndefined();
    expect(buildDirectEgressTrustedCaCertificates([])).toBeUndefined();
  });

  it("augments Node's default trust store with configured direct egress CA certificates", () => {
    const configuredCertificate = [
      "-----BEGIN CERTIFICATE-----",
      "MIIBdirectegressconfiguredca",
      "-----END CERTIFICATE-----",
    ].join("\n");

    const certificates = buildDirectEgressTrustedCaCertificates([configuredCertificate]);

    expect(certificates).toEqual([...rootCertificates, configuredCertificate]);
  });
});
