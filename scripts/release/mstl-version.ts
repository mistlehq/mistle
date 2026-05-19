import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { updateCargoTomlPackageVersion } from "./sandboxd-version.js";

const MstlPackagePaths = [
  ["packages", "mstl-core", "Cargo.toml"],
  ["packages", "mstl-cli", "Cargo.toml"],
];

export function updateMstlCargoTomlVersionFiles(repositoryRootPath: string, version: string): void {
  for (const packagePathSegments of MstlPackagePaths) {
    const cargoTomlPath = join(repositoryRootPath, ...packagePathSegments);
    const cargoTomlContent = readFileSync(cargoTomlPath, "utf8");
    writeFileSync(
      cargoTomlPath,
      updateCargoTomlPackageVersion(cargoTomlContent, packagePathSegments.join("/"), version),
      "utf8",
    );
  }
}

export function mstlCoreCargoLockUpdateArgs(repositoryRootPath: string, version: string): string[] {
  return [
    "update",
    "--manifest-path",
    join(repositoryRootPath, "packages", "mstl-core", "Cargo.toml"),
    "--package",
    "mstl-core",
    "--precise",
    version,
  ];
}

export function mstlCliCargoLockUpdateArgs(
  repositoryRootPath: string,
  packageName: string,
  version: string,
): string[] {
  return [
    "update",
    "--manifest-path",
    join(repositoryRootPath, "packages", "mstl-cli", "Cargo.toml"),
    "--package",
    packageName,
    "--precise",
    version,
  ];
}

export function updateMstlCargoLockFiles(repositoryRootPath: string, version: string): void {
  execFileSync("cargo", mstlCoreCargoLockUpdateArgs(repositoryRootPath, version), {
    cwd: repositoryRootPath,
    stdio: "inherit",
  });

  for (const packageName of ["mstl-core", "mstl-cli"]) {
    execFileSync("cargo", mstlCliCargoLockUpdateArgs(repositoryRootPath, packageName, version), {
      cwd: repositoryRootPath,
      stdio: "inherit",
    });
  }
}
