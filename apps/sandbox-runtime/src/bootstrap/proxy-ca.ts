import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateProxyCa, issueProxyLeafCertificate } from "@mistle/sandbox-rs-napi";

import { prepareNativeProxyCaRuntimeEnv } from "../native/proxy-ca-host.js";
import { ProxyCaCertFdEnv, ProxyCaKeyFdEnv } from "../runtime/config.js";

export const UpdateCaCertificatesPath = "/usr/sbin/update-ca-certificates";
export const ProxyCaCertInstallPath = "/usr/local/share/ca-certificates/mistle-proxy-ca.crt";
export const SystemTrustBundlePath = "/etc/ssl/certs/ca-certificates.crt";
export const SystemCertificatesDirectoryPath = "/etc/ssl/certs";
const OpenSslPath = "openssl";
const CurlPath = "curl";
const DirectHttpsProbePath = "/__bootstrap_proxy_ca_probe";
const DirectHttpsProbeResponseBody = "proxy-ca-probe-ok";

const execFileAsync = promisify(execFile);

export type GeneratedProxyCa = ReturnType<typeof generateProxyCa>;

type ProxyCaVerificationPaths = {
  installedCertificatePath?: string;
  trustBundlePath?: string;
  certificatesDirectoryPath?: string;
};

function buildExecErrorMessage(input: { tool: string; args: string[]; error: unknown }): string {
  if (!(input.error instanceof Error)) {
    return `failed to run ${input.tool}: ${String(input.error)}`;
  }

  const stdout =
    "stdout" in input.error && typeof input.error.stdout === "string"
      ? input.error.stdout.trim()
      : "";
  const stderr =
    "stderr" in input.error && typeof input.error.stderr === "string"
      ? input.error.stderr.trim()
      : "";
  const output = [stdout, stderr].filter((value) => value.length > 0).join("\n");
  const commandText = [input.tool, ...input.args].join(" ");

  return output.length === 0
    ? `failed to run ${commandText}: ${input.error.message}`
    : `failed to run ${commandText}: ${input.error.message} (output=${output})`;
}

async function execFileUtf8(input: {
  tool: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    const result = await execFileAsync(input.tool, input.args, {
      env: input.env,
      encoding: "utf8",
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(
      buildExecErrorMessage({
        tool: input.tool,
        args: input.args,
        error,
      }),
    );
  }
}

async function listenDirectHttpsProbeServer(input: {
  certificateChainPem: string;
  privateKeyPem: string;
}): Promise<{ server: HttpsServer; url: string }> {
  const server = createHttpsServer(
    {
      cert: input.certificateChainPem,
      key: input.privateKeyPem,
      minVersion: "TLSv1.2",
    },
    (request, response) => {
      if (request.method !== "GET" || request.url !== DirectHttpsProbePath) {
        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("not found");
        return;
      }

      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(DirectHttpsProbeResponseBody.length),
      });
      response.end(DirectHttpsProbeResponseBody);
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeHttpsServer(server);
    throw new Error("direct https probe server address is unavailable");
  }

  return {
    server,
    url: `https://localhost:${String(address.port)}${DirectHttpsProbePath}`,
  };
}

async function closeHttpsServer(server: HttpsServer): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function extractLeafCertificatePem(certificateChainPem: string): string {
  const endMarker = "-----END CERTIFICATE-----";
  const endIndex = certificateChainPem.indexOf(endMarker);
  if (endIndex < 0) {
    throw new Error("proxy leaf certificate chain pem is invalid");
  }

  return `${certificateChainPem.slice(0, endIndex + endMarker.length)}\n`;
}

async function resolveCertificateHash(installedCertificatePath: string): Promise<string> {
  const hash = await execFileUtf8({
    tool: OpenSslPath,
    args: ["x509", "-hash", "-noout", "-in", installedCertificatePath],
  });
  if (hash.length === 0) {
    throw new Error("installed proxy ca certificate hash is empty");
  }

  return hash;
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

  await writeFile(ProxyCaCertInstallPath, certificatePem, {
    encoding: "utf8",
    mode: 0o644,
  });
  await runUpdateCaCertificates();
}

export async function verifyInstalledProxyCaCertificate(
  certificatePem: string,
  paths?: ProxyCaVerificationPaths,
): Promise<void> {
  const installedCertificatePath = paths?.installedCertificatePath ?? ProxyCaCertInstallPath;
  const certificatesDirectoryPath =
    paths?.certificatesDirectoryPath ?? SystemCertificatesDirectoryPath;
  const installedCertificatePem = await readFile(installedCertificatePath, "utf8");
  if (installedCertificatePem.trim() !== certificatePem.trim()) {
    throw new Error(`installed proxy ca certificate at ${installedCertificatePath} did not match`);
  }

  const certificateHash = await resolveCertificateHash(installedCertificatePath);
  const certificateDirectoryEntries = await readdir(certificatesDirectoryPath);
  const matchingHashEntries = certificateDirectoryEntries.filter((entry) =>
    entry.startsWith(`${certificateHash}.`),
  );
  if (matchingHashEntries.length === 0) {
    throw new Error(
      `installed proxy ca certificate hash entry ${certificateHash}.* was not found in ${certificatesDirectoryPath}`,
    );
  }

  for (const entry of matchingHashEntries) {
    const candidatePath = join(certificatesDirectoryPath, entry);
    const candidatePem = await readFile(candidatePath, "utf8").catch(() => undefined);
    if (candidatePem !== undefined && candidatePem.trim() === certificatePem.trim()) {
      return;
    }
  }

  throw new Error(
    `installed proxy ca certificate was not present in any hash entry under ${certificatesDirectoryPath}`,
  );
}

export async function verifyProxyCaTrustChain(
  proxyCa: GeneratedProxyCa,
  paths?: ProxyCaVerificationPaths,
): Promise<void> {
  const trustBundlePath = paths?.trustBundlePath ?? SystemTrustBundlePath;
  const leafCertificate = issueProxyLeafCertificate({
    caCertificatePem: proxyCa.certificatePem,
    caPrivateKeyPem: proxyCa.privateKeyPem,
    serverName: "localhost",
  });
  const verificationDirectory = await mkdtemp(join(tmpdir(), "mistle-proxy-ca-verify-"));

  try {
    const leafCertificatePath = join(verificationDirectory, "leaf.pem");
    await writeFile(
      leafCertificatePath,
      extractLeafCertificatePem(leafCertificate.certificateChainPem),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );

    await execFileUtf8({
      tool: OpenSslPath,
      args: ["verify", "-CAfile", trustBundlePath, leafCertificatePath],
    });
  } finally {
    await rm(verificationDirectory, {
      force: true,
      recursive: true,
    });
  }
}

export async function runDirectProxyCaHttpsProbe(
  proxyCa: GeneratedProxyCa,
  paths?: ProxyCaVerificationPaths,
): Promise<void> {
  const trustBundlePath = paths?.trustBundlePath ?? SystemTrustBundlePath;
  const issuedLeafCertificate = issueProxyLeafCertificate({
    caCertificatePem: proxyCa.certificatePem,
    caPrivateKeyPem: proxyCa.privateKeyPem,
    serverName: "localhost",
  });
  const probeServer = await listenDirectHttpsProbeServer({
    certificateChainPem: issuedLeafCertificate.certificateChainPem,
    privateKeyPem: issuedLeafCertificate.privateKeyPem,
  });

  try {
    const responseBody = await execFileUtf8({
      tool: CurlPath,
      args: [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "--noproxy",
        "*",
        probeServer.url,
      ],
      env: {
        ...process.env,
        CURL_CA_BUNDLE: trustBundlePath,
        SSL_CERT_FILE: trustBundlePath,
      },
    });

    if (responseBody !== DirectHttpsProbeResponseBody) {
      throw new Error(`direct https probe returned unexpected response body: ${responseBody}`);
    }
  } finally {
    await closeHttpsServer(probeServer.server);
  }
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
