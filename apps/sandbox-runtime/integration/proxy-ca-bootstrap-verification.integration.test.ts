import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateProxyCa } from "@mistle/sandbox-rs-napi";
import { afterEach, describe, expect, it } from "vitest";

import {
  runDirectProxyCaHttpsProbe,
  verifyInstalledProxyCaCertificate,
  verifyProxyCaTrustChain,
} from "../src/bootstrap/proxy-ca.js";

const execFileAsync = promisify(execFile);
const TemporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), prefix));
  TemporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function resolveCertificateHash(installedCertificatePath: string): Promise<string> {
  const result = await execFileAsync(
    "openssl",
    ["x509", "-hash", "-noout", "-in", installedCertificatePath],
    {
      encoding: "utf8",
    },
  );
  const hash = result.stdout.trim();
  if (hash.length === 0) {
    throw new Error("certificate hash must not be empty");
  }

  return hash;
}

async function createVerificationPaths(input: {
  certificatePem: string;
  trustBundlePem?: string;
}): Promise<{
  installedCertificatePath: string;
  trustBundlePath: string;
  certificatesDirectoryPath: string;
}> {
  const directoryPath = await createTemporaryDirectory("mistle-proxy-ca-bootstrap-");
  const installedCertificatePath = join(directoryPath, "mistle-proxy-ca.crt");
  const trustBundlePath = join(directoryPath, "ca-certificates.crt");
  const certificatesDirectoryPath = join(directoryPath, "certs");

  await mkdir(certificatesDirectoryPath, {
    recursive: true,
    mode: 0o755,
  });
  await writeFile(installedCertificatePath, input.certificatePem, {
    encoding: "utf8",
    mode: 0o644,
  });
  await writeFile(trustBundlePath, input.trustBundlePem ?? input.certificatePem, {
    encoding: "utf8",
    mode: 0o644,
  });

  const certificateHash = await resolveCertificateHash(installedCertificatePath);
  await writeFile(join(certificatesDirectoryPath, `${certificateHash}.0`), input.certificatePem, {
    encoding: "utf8",
    mode: 0o644,
  });

  return {
    installedCertificatePath,
    trustBundlePath,
    certificatesDirectoryPath,
  };
}

afterEach(async () => {
  while (TemporaryDirectories.length > 0) {
    const directoryPath = TemporaryDirectories.pop();
    if (directoryPath !== undefined) {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }
  }
});

describe("bootstrap proxy ca verification", () => {
  it("verifies the installed certificate and hash entry", async () => {
    const proxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: proxyCa.certificatePem,
    });

    await expect(
      verifyInstalledProxyCaCertificate(proxyCa.certificatePem, paths),
    ).resolves.toBeUndefined();
  });

  it("fails installed certificate verification when the installed cert does not match", async () => {
    const proxyCa = generateProxyCa();
    const otherProxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: otherProxyCa.certificatePem,
      trustBundlePem: proxyCa.certificatePem,
    });

    await expect(verifyInstalledProxyCaCertificate(proxyCa.certificatePem, paths)).rejects.toThrow(
      `installed proxy ca certificate at ${paths.installedCertificatePath} did not match`,
    );
  });

  it("verifies the proxy ca trust chain against the bundle", async () => {
    const proxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: proxyCa.certificatePem,
    });

    await expect(verifyProxyCaTrustChain(proxyCa, paths)).resolves.toBeUndefined();
  });

  it("fails trust-chain verification when the trust bundle does not include the generated ca", async () => {
    const proxyCa = generateProxyCa();
    const otherProxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: proxyCa.certificatePem,
      trustBundlePem: otherProxyCa.certificatePem,
    });

    await expect(verifyProxyCaTrustChain(proxyCa, paths)).rejects.toThrow(
      /failed to run openssl verify/u,
    );
  });

  it("probes a loopback https server with the trust bundle", async () => {
    const proxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: proxyCa.certificatePem,
    });

    await expect(runDirectProxyCaHttpsProbe(proxyCa, paths)).resolves.toBeUndefined();
  });

  it("fails the loopback https probe when the trust bundle does not include the generated ca", async () => {
    const proxyCa = generateProxyCa();
    const otherProxyCa = generateProxyCa();
    const paths = await createVerificationPaths({
      certificatePem: proxyCa.certificatePem,
      trustBundlePem: otherProxyCa.certificatePem,
    });

    await expect(runDirectProxyCaHttpsProbe(proxyCa, paths)).rejects.toThrow(/failed to run curl/u);
  });
});
