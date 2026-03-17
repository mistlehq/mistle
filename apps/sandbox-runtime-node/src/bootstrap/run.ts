import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extname } from "node:path";

import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { loadBootstrapConfig } from "./config.js";
import { execRuntime } from "./exec-runtime.js";
import { installProxyCaCertificate, prepareProxyCaRuntimeEnv } from "./proxy-ca.js";
import {
  buildPackagedRuntimeExecInput,
  buildRuntimeExecInput,
  PackagedRuntimeBinaryName,
} from "./runtime-exec-input.js";

type PasswdUserRecord = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
};

type LookupEnv = (key: string) => string | undefined;

type RunBootstrapInput = {
  lookupEnv: LookupEnv;
  processArgv: readonly string[];
  runtimeExecTarget:
    | {
        kind: "node-script";
        bootstrapEntrypointPath: string;
      }
    | {
        kind: "packaged-binary";
        runtimeExecutablePath: string;
      };
};

function parsePasswdUserRecord(line: string): PasswdUserRecord | undefined {
  const parts = line.split(":");
  if (parts.length < 7) {
    return undefined;
  }

  const [username, , rawUid, rawGid, , homeDir] = parts;
  if (
    username === undefined ||
    rawUid === undefined ||
    rawGid === undefined ||
    homeDir === undefined
  ) {
    return undefined;
  }

  const uid = Number.parseInt(rawUid, 10);
  const gid = Number.parseInt(rawGid, 10);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
    return undefined;
  }

  return {
    username,
    uid,
    gid,
    homeDir,
  };
}

async function resolveSandboxUser(username: string): Promise<PasswdUserRecord> {
  const passwdEntries = (await readFile("/etc/passwd", "utf8")).split("\n");

  for (const entry of passwdEntries) {
    const parsedRecord = parsePasswdUserRecord(entry);
    if (parsedRecord?.username === username) {
      return parsedRecord;
    }
  }

  throw new Error(`failed to resolve sandbox user "${username}"`);
}

function resolveRuntimeEntrypointPath(bootstrapEntrypointPath: string): string {
  const extension = extname(bootstrapEntrypointPath);
  const bootstrapSuffix = `/bootstrap/main${extension}`;
  if (!bootstrapEntrypointPath.endsWith(bootstrapSuffix)) {
    throw new Error(
      `unexpected bootstrap entrypoint path "${bootstrapEntrypointPath}": expected suffix "${bootstrapSuffix}"`,
    );
  }

  return `${bootstrapEntrypointPath.slice(0, -bootstrapSuffix.length)}/main${extension}`;
}

export async function runBootstrap(input: RunBootstrapInput): Promise<void> {
  if (typeof process.geteuid !== "function" || process.geteuid() !== 0) {
    throw new Error("sandbox bootstrap must start as root");
  }

  const config = loadBootstrapConfig(input.lookupEnv);
  const proxyCa = generateProxyCa();
  await installProxyCaCertificate(proxyCa.certificatePem);
  const proxyCaRuntimeEnv = prepareProxyCaRuntimeEnv(proxyCa);
  try {
    const sandboxUser = await resolveSandboxUser(config.sandboxUser);
    if (sandboxUser.uid === 0) {
      throw new Error(`sandbox user "${sandboxUser.username}" must not resolve to uid 0`);
    }

    const runtimeExecInput =
      input.runtimeExecTarget.kind === "node-script"
        ? buildRuntimeExecInput({
            processEnv: process.env,
            processArgv: input.processArgv,
            bootstrapEntrypointPath: input.runtimeExecTarget.bootstrapEntrypointPath,
            runtimeEntrypointPath: resolveRuntimeEntrypointPath(
              input.runtimeExecTarget.bootstrapEntrypointPath,
            ),
            userRecord: sandboxUser,
            additionalEnv: proxyCaRuntimeEnv.env,
          })
        : buildPackagedRuntimeExecInput({
            processEnv: process.env,
            processArgv: input.processArgv,
            runtimeExecutablePath: input.runtimeExecTarget.runtimeExecutablePath,
            userRecord: sandboxUser,
            additionalEnv: proxyCaRuntimeEnv.env,
          });

    execRuntime(runtimeExecInput);
  } finally {
    proxyCaRuntimeEnv.cleanup();
  }
}

export function resolvePackagedRuntimeExecutablePath(bootstrapExecutablePath: string): string {
  return join(dirname(bootstrapExecutablePath), PackagedRuntimeBinaryName);
}
