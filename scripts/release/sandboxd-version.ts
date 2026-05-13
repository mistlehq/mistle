import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";

const PackageSectionVersionPattern =
  /(^\[package\]\r?\n(?:(?!^\[).*\r?\n)*?^version\s*=\s*)"[^"\r\n]*"(\s*(?:#.*)?$)/mu;

function isTomlTable(value: unknown): value is TomlTableWithoutBigInt {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function updateSandboxdCargoTomlVersion(cargoTomlContent: string, version: string): string {
  const parsedCargoToml = parseToml(cargoTomlContent);
  const packageSection = parsedCargoToml.package;

  if (!isTomlTable(packageSection)) {
    throw new Error("packages/sandboxd/Cargo.toml must contain a [package] table.");
  }

  if (typeof packageSection.version !== "string") {
    throw new Error("packages/sandboxd/Cargo.toml [package].version must be a string.");
  }

  const updatedContent = cargoTomlContent.replace(PackageSectionVersionPattern, `$1"${version}"$2`);

  if (updatedContent === cargoTomlContent && packageSection.version !== version) {
    throw new Error("Failed to update packages/sandboxd/Cargo.toml [package].version.");
  }

  return updatedContent;
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
