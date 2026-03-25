"use strict";

const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

function isFunction(value) {
  return typeof value === "function";
}

function resolveNativeAddonPath() {
  const sidecarDirectory = path.dirname(process.execPath);
  const candidates = fs
    .readdirSync(sidecarDirectory)
    .filter((entry) => /^index\..+\.node$/u.test(entry));

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one colocated sandbox native addon in ${sidecarDirectory}, found ${String(candidates.length)}.`,
    );
  }

  return path.join(sidecarDirectory, candidates[0]);
}

function loadNativeBinding() {
  const sidecarRequire = createRequire(process.execPath);
  const nativeBinding = sidecarRequire(resolveNativeAddonPath());
  if (typeof nativeBinding !== "object" || nativeBinding === null) {
    throw new Error("sandbox native addon did not export an object");
  }

  return nativeBinding;
}

function readExport(binding, key) {
  const value = binding[key];
  if (!isFunction(value)) {
    throw new Error(`sandbox native addon export "${key}" is missing or invalid`);
  }

  return value;
}

const nativeBinding = loadNativeBinding();

module.exports = {
  NativePtySession: readExport(nativeBinding, "NativePtySession"),
  assertUnixSocketPeerMatchesCurrentProcessUid: readExport(
    nativeBinding,
    "assertUnixSocketPeerMatchesCurrentProcessUid",
  ),
  execRuntimeAsUser: readExport(nativeBinding, "execRuntimeAsUser"),
  generateProxyCa: readExport(nativeBinding, "generateProxyCa"),
  issueProxyLeafCertificate: readExport(nativeBinding, "issueProxyLeafCertificate"),
  prepareProxyCaRuntime: readExport(nativeBinding, "prepareProxyCaRuntime"),
  setCurrentProcessNonDumpable: readExport(nativeBinding, "setCurrentProcessNonDumpable"),
  spawnManagedProcess: readExport(nativeBinding, "spawnManagedProcess"),
  spawnPty: readExport(nativeBinding, "spawnPty"),
};
