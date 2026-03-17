import { readFile } from "node:fs/promises";

import { generateProxyCa } from "@mistle/sandbox-rs-napi";

import { runRuntime } from "../runtime/run.js";
import { loadBootstrapConfig } from "./config.js";
import { installProxyCaCertificate, prepareProxyCaRuntimeEnv } from "./proxy-ca.js";

type PasswdUserRecord = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
};

type LookupEnv = (key: string) => string | undefined;

type RunBootstrapInput = {
  lookupEnv: LookupEnv;
  stdin: NodeJS.ReadableStream;
};

const HomeEnv = "HOME";
const LognameEnv = "LOGNAME";
const UserEnv = "USER";

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

function applyRuntimeEnvironment(userRecord: PasswdUserRecord): void {
  delete process.env[HomeEnv];
  delete process.env[LognameEnv];
  delete process.env[UserEnv];

  process.env[HomeEnv] = userRecord.homeDir;
  process.env[LognameEnv] = userRecord.username;
  process.env[UserEnv] = userRecord.username;
}

function dropPrivileges(userRecord: PasswdUserRecord): void {
  if (
    typeof process.setgroups !== "function" ||
    typeof process.setgid !== "function" ||
    typeof process.setuid !== "function"
  ) {
    throw new Error("sandbox bootstrap requires posix privilege controls");
  }

  process.setgroups([userRecord.gid]);
  process.setgid(userRecord.gid);
  process.setuid(userRecord.uid);
}

function lookupProcessEnv(key: string): string | undefined {
  return process.env[key];
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

    for (const [envName, envValue] of Object.entries(proxyCaRuntimeEnv.env)) {
      process.env[envName] = envValue;
    }

    applyRuntimeEnvironment(sandboxUser);
    dropPrivileges(sandboxUser);

    await runRuntime({
      lookupEnv: lookupProcessEnv,
      stdin: input.stdin,
    });
  } finally {
    proxyCaRuntimeEnv.cleanup();
  }
}
