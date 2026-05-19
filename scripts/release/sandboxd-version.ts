import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";

const PackageSectionVersionPattern =
  /(^\[package\]\r?\n(?:(?!^\[).*\r?\n)*?^version\s*=\s*)"[^"\r\n]*"(\s*(?:#.*)?$)/mu;

function isTomlTable(value: unknown): value is TomlTableWithoutBigInt {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function updateCargoTomlPackageVersion(
  cargoTomlContent: string,
  packageDisplayPath: string,
  version: string,
): string {
  const parsedCargoToml = parseToml(cargoTomlContent);
  const packageSection = parsedCargoToml.package;

  if (!isTomlTable(packageSection)) {
    throw new Error(`${packageDisplayPath} must contain a [package] table.`);
  }

  if (typeof packageSection.version !== "string") {
    throw new Error(`${packageDisplayPath} [package].version must be a string.`);
  }

  const updatedContent = cargoTomlContent.replace(PackageSectionVersionPattern, `$1"${version}"$2`);

  if (updatedContent === cargoTomlContent && packageSection.version !== version) {
    throw new Error(`Failed to update ${packageDisplayPath} [package].version.`);
  }

  return updatedContent;
}

export function updateSandboxdCargoTomlVersion(cargoTomlContent: string, version: string): string {
  return updateCargoTomlPackageVersion(cargoTomlContent, "packages/sandboxd/Cargo.toml", version);
}

export function updateSandboxdCargoTomlVersionFile(
  repositoryRootPath: string,
  version: string,
): void {
  const sandboxdCargoTomlPath = join(repositoryRootPath, "packages", "sandboxd", "Cargo.toml");
  const cargoTomlContent = readFileSync(sandboxdCargoTomlPath, "utf8");
  writeFileSync(
    sandboxdCargoTomlPath,
    updateSandboxdCargoTomlVersion(cargoTomlContent, version),
    "utf8",
  );
}

export function sandboxdCargoLockUpdateArgs(repositoryRootPath: string, version: string): string[] {
  return [
    "update",
    "--manifest-path",
    join(repositoryRootPath, "packages", "sandboxd", "Cargo.toml"),
    "--package",
    "sandboxd",
    "--precise",
    version,
  ];
}

export function updateSandboxdCargoLockFile(repositoryRootPath: string, version: string): void {
  execFileSync("cargo", sandboxdCargoLockUpdateArgs(repositoryRootPath, version), {
    cwd: repositoryRootPath,
    stdio: "inherit",
  });
}
