import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type JsonValue = boolean | number | string | null | JsonObject | JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue | undefined };

const WorkspacePackageRoots = ["apps", "packages", "tests"];
const SourceOnlyPackages = new Set(["@mistle/test-harness", "@mistle/ui"]);
const WrapperRuntimePackages = new Set(["@mistle/sandbox-session-client"]);
const ExportConditionOrder = ["types", "workspace-src", "node", "import", "default"];
const PackageImportPattern =
  /(?:\bimport\s+(?:[^"';]*?\s+from\s+)?["']|\bexport\s+(?:(?:type\s+)?[^"';]*?\s+from\s+|\*\s+from\s+)["']|\bimport\s*\(\s*["'])(@mistle\/[^"']+)/g;

type PackageInfo = {
  readonly name: string;
  readonly path: string;
  readonly root: string;
  readonly packageJson: JsonObject;
  readonly exportsValue: JsonValue | undefined;
};

type PackageExportValidationInput = {
  readonly workspaceRoot?: string;
  readonly workspacePackageRoots?: readonly string[];
};

export function validatePackageExports(input: PackageExportValidationInput = {}): string[] {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const workspacePackageRoots = input.workspacePackageRoots ?? WorkspacePackageRoots;
  const packages = loadWorkspacePackages(workspaceRoot, workspacePackageRoots);
  const packageByName = new Map(packages.map((packageInfo) => [packageInfo.name, packageInfo]));
  return [
    ...validateExportShapes(packages),
    ...validateInternalImports(packageByName, workspaceRoot, workspacePackageRoots),
  ];
}

function main(): void {
  const errors = validatePackageExports();

  if (errors.length > 0) {
    console.error("Package export validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}

function loadWorkspacePackages(
  workspaceRoot: string,
  workspacePackageRoots: readonly string[],
): PackageInfo[] {
  const packages: PackageInfo[] = [];

  for (const packageRoot of workspacePackageRoots) {
    for (const packageJsonPath of findPackageJsonFiles(join(workspaceRoot, packageRoot))) {
      const packageJson = readJsonObject(packageJsonPath);
      const name = readString(packageJson["name"]);
      if (!name?.startsWith("@mistle/")) {
        continue;
      }

      packages.push({
        name,
        path: packageJsonPath,
        root: packageJsonPath.slice(0, -"/package.json".length),
        packageJson,
        exportsValue: packageJson["exports"],
      });
    }
  }

  return packages;
}

function findPackageJsonFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...findPackageJsonFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name === "package.json") {
      files.push(path);
    }
  }

  return files;
}

function validateExportShapes(packages: PackageInfo[]): string[] {
  const errors: string[] = [];

  for (const packageInfo of packages) {
    const exportsObject = readObject(packageInfo.exportsValue);
    if (!exportsObject) {
      continue;
    }

    for (const [subpath, exportValue] of Object.entries(exportsObject)) {
      if (subpath.includes("*")) {
        errors.push(`${packageInfo.path}: wildcard export ${subpath} is not allowed`);
        continue;
      }

      if (typeof exportValue === "string") {
        validateStringExportTarget(errors, packageInfo, subpath, exportValue);
        continue;
      }

      const conditionObject = readObject(exportValue);
      if (!conditionObject) {
        errors.push(`${packageInfo.path}: export ${subpath} must be a string or condition object`);
        continue;
      }

      validateConditionExport(errors, packageInfo, subpath, conditionObject);
    }
  }

  return errors;
}

function validateStringExportTarget(
  errors: string[],
  packageInfo: PackageInfo,
  subpath: string,
  target: string,
): void {
  if (!isAssetExport(subpath, target)) {
    errors.push(
      `${packageInfo.path}: export ${subpath} must use a condition object unless it is an explicit asset export`,
    );
    return;
  }

  if (!target.startsWith("./")) {
    errors.push(`${packageInfo.path}: export ${subpath} target ${target} must be package-relative`);
    return;
  }

  if (!fileExists(join(packageInfo.root, target))) {
    errors.push(`${packageInfo.path}: export ${subpath} target ${target} does not exist`);
  }
}

function validateConditionExport(
  errors: string[],
  packageInfo: PackageInfo,
  subpath: string,
  conditionObject: JsonObject,
): void {
  validateConditionOrder(errors, packageInfo, subpath, conditionObject);

  const typesTarget = readString(conditionObject["types"]);
  const workspaceTarget = readString(conditionObject["workspace-src"]);
  const runtimeTargets: [string, string | undefined][] = [
    ["node", readString(conditionObject["node"])],
    ["import", readString(conditionObject["import"])],
    ["default", readString(conditionObject["default"])],
  ];

  if (!typesTarget) {
    errors.push(`${packageInfo.path}: export ${subpath} is missing a types condition`);
  } else {
    validateSourceTarget(errors, packageInfo, subpath, "types", typesTarget);
  }

  if (!workspaceTarget) {
    errors.push(`${packageInfo.path}: export ${subpath} is missing a workspace-src condition`);
  } else {
    validateSourceTarget(errors, packageInfo, subpath, "workspace-src", workspaceTarget);
  }

  for (const [condition, target] of runtimeTargets) {
    if (!target) {
      if (condition === "node" && packageInfo.name === "@mistle/ui") {
        continue;
      }
      errors.push(`${packageInfo.path}: export ${subpath} is missing a ${condition} condition`);
      continue;
    }

    validateRuntimeTarget(errors, packageInfo, subpath, condition, target);
  }
}

function validateSourceTarget(
  errors: string[],
  packageInfo: PackageInfo,
  subpath: string,
  condition: string,
  target: string,
): void {
  if (!target.startsWith("./src/")) {
    errors.push(
      `${packageInfo.path}: export ${subpath} ${condition} target ${target} must point at ./src`,
    );
    return;
  }

  if (!fileExists(join(packageInfo.root, target))) {
    errors.push(
      `${packageInfo.path}: export ${subpath} ${condition} target ${target} does not exist`,
    );
  }
}

function validateRuntimeTarget(
  errors: string[],
  packageInfo: PackageInfo,
  subpath: string,
  condition: string,
  target: string,
): void {
  if (SourceOnlyPackages.has(packageInfo.name)) {
    validateSourceTarget(errors, packageInfo, subpath, condition, target);
    return;
  }

  if (WrapperRuntimePackages.has(packageInfo.name)) {
    if (target.startsWith("./src/")) {
      errors.push(
        `${packageInfo.path}: export ${subpath} ${condition} target ${target} must not point at source`,
      );
      return;
    }
    if (!target.endsWith(".js")) {
      errors.push(
        `${packageInfo.path}: export ${subpath} ${condition} wrapper target ${target} must end in .js`,
      );
      return;
    }
    if (!fileExists(join(packageInfo.root, target))) {
      errors.push(
        `${packageInfo.path}: export ${subpath} ${condition} wrapper target ${target} does not exist`,
      );
    }
    return;
  }

  if (!target.startsWith("./dist/")) {
    errors.push(
      `${packageInfo.path}: export ${subpath} ${condition} target ${target} must point at ./dist`,
    );
    return;
  }

  if (!target.endsWith(".js")) {
    errors.push(
      `${packageInfo.path}: export ${subpath} ${condition} target ${target} must end in .js`,
    );
    return;
  }

  const sourcePeer = sourcePeerForDistTarget(target);
  if (!fileExists(join(packageInfo.root, sourcePeer))) {
    errors.push(
      `${packageInfo.path}: export ${subpath} ${condition} target ${target} has no source peer ${sourcePeer}`,
    );
  }
}

function validateInternalImports(
  packageByName: Map<string, PackageInfo>,
  workspaceRoot: string,
  workspacePackageRoots: readonly string[],
): string[] {
  const errors: string[] = [];

  for (const filePath of findSourceFiles(workspaceRoot, workspacePackageRoots)) {
    const text = readFileSync(filePath, "utf8");
    for (const match of text.matchAll(PackageImportPattern)) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }

      const resolution = parsePackageSpecifier(specifier);
      const packageInfo = packageByName.get(resolution.packageName);
      if (!packageInfo) {
        continue;
      }

      const exportsObject = readObject(packageInfo.exportsValue);
      if (!exportsObject) {
        errors.push(
          `${filePath}: ${specifier} imports package ${resolution.packageName}, which has no exports`,
        );
        continue;
      }

      if (exportsObject[resolution.subpath] === undefined) {
        errors.push(`${filePath}: ${specifier} is not an explicit export`);
      }
    }
  }

  return errors;
}

function validateConditionOrder(
  errors: string[],
  packageInfo: PackageInfo,
  subpath: string,
  conditionObject: JsonObject,
): void {
  let previousKnownConditionIndex = -1;
  for (const condition of Object.keys(conditionObject)) {
    const conditionIndex = ExportConditionOrder.indexOf(condition);
    if (conditionIndex === -1) {
      continue;
    }

    if (conditionIndex < previousKnownConditionIndex) {
      errors.push(
        `${packageInfo.path}: export ${subpath} conditions must be ordered as ${ExportConditionOrder.join(
          ", ",
        )}`,
      );
      return;
    }

    previousKnownConditionIndex = conditionIndex;
  }
}

function findSourceFiles(workspaceRoot: string, directories: readonly string[]): string[] {
  const files: string[] = [];
  for (const directory of directories) {
    collectSourceFiles(join(workspaceRoot, directory), files);
  }
  return files;
}

function collectSourceFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      collectSourceFiles(path, files);
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(path);
    }
  }
}

function parsePackageSpecifier(specifier: string): { packageName: string; subpath: string } {
  const parts = specifier.split("/");
  const packageName = `${parts[0]}/${parts[1]}`;
  const subpath = parts.length === 2 ? "." : `./${parts.slice(2).join("/")}`;
  return { packageName, subpath };
}

function sourcePeerForDistTarget(target: string): string {
  const withoutPrefix = target.slice("./dist/".length);
  return `./src/${withoutPrefix.slice(0, -".js".length)}.ts`;
}

function isAssetExport(subpath: string, target: string): boolean {
  return subpath.endsWith(".css") && target.endsWith(".css");
}

function readJsonObject(path: string): JsonObject {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

function readObject(value: JsonValue | undefined): JsonObject | undefined {
  if (isJsonObject(value)) {
    return value;
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const entrypointUrl = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;

if (entrypointUrl === import.meta.url) {
  main();
}
