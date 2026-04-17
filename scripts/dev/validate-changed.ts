import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Step = "format" | "lint" | "typecheck" | "test";

type WorkspacePackage = {
  dependencies: Set<string>;
  name: string;
  path: string;
  policySteps: Step[];
  relativePath: string;
};

type ParseArgsResult = {
  baseRef: string | null;
  changedFilesOverride: string[] | null;
  dryRun: boolean;
  headRef: string | null;
  steps: Step[];
};

type ValidationPlan = {
  allPackagesSelected: boolean;
  changedFiles: string[];
  extraCommands: Record<Step, string[][]>;
  packageReasons: Map<string, string[]>;
  selectedPackages: WorkspacePackage[];
};

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_BRANCH_COMPARE_BASE_REF = "origin/main";
const DEFAULT_BRANCH_COMPARE_HEAD_REF = "HEAD";
const WORKSPACE_ROOTS = ["apps", "packages", "tests"] as const;
const VALIDATION_STEPS: readonly Step[] = ["format", "lint", "typecheck", "test"];
const DEFAULT_WORKSPACE_POLICY_STEPS: readonly Step[] = ["format", "lint", "typecheck", "test"];
const TESTS_POLICY_STEPS: readonly Step[] = ["lint", "typecheck"];

const ALL_PACKAGES_REASON = "root-level or repo-wide config changed";

const REPO_WIDE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  ".lintstagedrc.json",
]);

function printUsage(): void {
  console.log(`Usage: pnpm validate:changed [options]

Defaults to current working tree changes:
  - staged files
  - unstaged tracked files
  - untracked files

Options:
  --base <ref>       Base ref for branch comparison (must be used with --head or alone)
  --head <ref>       Head ref for branch comparison (default with --base: ${DEFAULT_BRANCH_COMPARE_HEAD_REF})
  --files <list>     Comma-separated file list; skips git diff lookup
  --steps <list>     Comma-separated steps: format,lint,typecheck,test
  --dry-run          Print the plan without executing commands
  --help             Show this message
`);
}

function parseArgs(argv: readonly string[]): ParseArgsResult {
  let baseRef: string | null = null;
  let headRef: string | null = null;
  let changedFilesOverride: string[] | null = null;
  let dryRun = false;
  let steps: Step[] = [...VALIDATION_STEPS];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--base") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error("Missing value for --base.");
      }
      baseRef = nextValue;
      index += 1;
      continue;
    }

    if (argument === "--head") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error("Missing value for --head.");
      }
      headRef = nextValue;
      index += 1;
      continue;
    }

    if (argument === "--files") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error("Missing value for --files.");
      }
      changedFilesOverride = nextValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      index += 1;
      continue;
    }

    if (argument === "--steps") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error("Missing value for --steps.");
      }

      const parsedSteps = nextValue
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is Step => VALIDATION_STEPS.includes(value as Step));

      if (parsedSteps.length === 0) {
        throw new Error("Expected at least one valid step in --steps.");
      }

      steps = parsedSteps;
      index += 1;
      continue;
    }

    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (argument === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (headRef !== null && baseRef === null) {
    throw new Error("--head requires --base.");
  }

  if (baseRef !== null && headRef === null) {
    headRef = DEFAULT_BRANCH_COMPARE_HEAD_REF;
  }

  return {
    baseRef,
    changedFilesOverride,
    dryRun,
    headRef,
    steps,
  };
}

function normalizeRelativePath(inputPath: string): string {
  const resolvedPath = inputPath.startsWith(REPO_ROOT) ? inputPath : resolve(REPO_ROOT, inputPath);

  return relative(REPO_ROOT, resolvedPath).split(sep).join("/");
}

function getChangedFilesFromBranchComparison(baseRef: string, headRef: string): string[] {
  const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...${headRef}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getChangedFilesFromWorkingTree(): string[] {
  const trackedUnstagedOutput = execFileSync("git", ["diff", "--name-only"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const trackedStagedOutput = execFileSync("git", ["diff", "--name-only", "--cached"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  return Array.from(
    new Set(
      [trackedUnstagedOutput, trackedStagedOutput, untrackedOutput]
        .flatMap((output) => output.split("\n"))
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ).sort();
}

function findWorkspacePackageJsonFiles(): string[] {
  const packageJsonFiles: string[] = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, workspaceRoot);
    if (existsSync(absoluteRoot) === false) {
      continue;
    }

    const rootPackageJsonPath = join(absoluteRoot, "package.json");
    if (existsSync(rootPackageJsonPath)) {
      packageJsonFiles.push(rootPackageJsonPath);
    }

    const entries = readdirSync(absoluteRoot);
    for (const entry of entries) {
      const entryPath = join(absoluteRoot, entry);
      if (statSync(entryPath).isDirectory() === false) {
        continue;
      }

      const packageJsonPath = join(entryPath, "package.json");
      if (existsSync(packageJsonPath)) {
        packageJsonFiles.push(packageJsonPath);
      }
    }
  }

  return Array.from(new Set(packageJsonFiles)).sort();
}

function readInternalDependencies(packageJson: Record<string, unknown>): Set<string> {
  const internalDependencies = new Set<string>();
  const dependencyFields = ["dependencies", "devDependencies", "peerDependencies"] as const;

  for (const field of dependencyFields) {
    const value = packageJson[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    for (const [dependencyName, dependencyVersion] of Object.entries(value)) {
      if (typeof dependencyVersion === "string" && dependencyVersion.startsWith("workspace:")) {
        internalDependencies.add(dependencyName);
      }
    }
  }

  return internalDependencies;
}

function loadWorkspacePackages(): WorkspacePackage[] {
  return findWorkspacePackageJsonFiles().map((packageJsonPath) => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    const packageDirectory = resolve(packageJsonPath, "..");
    const relativePackagePath = relative(REPO_ROOT, packageDirectory).split(sep).join("/");

    return {
      dependencies: readInternalDependencies(packageJson),
      name: String(packageJson["name"]),
      path: packageDirectory,
      policySteps:
        relativePackagePath === "tests"
          ? [...TESTS_POLICY_STEPS]
          : [...DEFAULT_WORKSPACE_POLICY_STEPS],
      relativePath: relativePackagePath,
    };
  });
}

function buildDependentsMap(
  workspacePackages: readonly WorkspacePackage[],
): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();

  for (const workspacePackage of workspacePackages) {
    if (dependents.has(workspacePackage.name) === false) {
      dependents.set(workspacePackage.name, new Set());
    }
  }

  for (const workspacePackage of workspacePackages) {
    for (const dependencyName of workspacePackage.dependencies) {
      const dependentsForDependency = dependents.get(dependencyName);
      if (dependentsForDependency !== undefined) {
        dependentsForDependency.add(workspacePackage.name);
      }
    }
  }

  return dependents;
}

function collectTransitiveDependents(
  packageName: string,
  dependentsMap: ReadonlyMap<string, Set<string>>,
): Set<string> {
  const collected = new Set<string>();
  const queue = [packageName];

  while (queue.length > 0) {
    const nextPackage = queue.shift();
    if (nextPackage === undefined) {
      continue;
    }

    const directDependents = dependentsMap.get(nextPackage);
    if (directDependents === undefined) {
      continue;
    }

    for (const dependent of directDependents) {
      if (collected.has(dependent)) {
        continue;
      }

      collected.add(dependent);
      queue.push(dependent);
    }
  }

  return collected;
}

function createEmptyExtraCommands(): Record<Step, string[][]> {
  return {
    format: [],
    lint: [],
    typecheck: [],
    test: [],
  };
}

function maybeAddCommand(commands: string[][], command: readonly string[], enabled: boolean): void {
  if (enabled) {
    commands.push([...command]);
  }
}

function createValidationPlan(
  changedFiles: readonly string[],
  steps: readonly Step[],
  workspacePackages: readonly WorkspacePackage[],
): ValidationPlan {
  const packageReasons = new Map<string, string[]>();
  const selectedPackageNames = new Set<string>();
  const extraCommands = createEmptyExtraCommands();
  const dependentsMap = buildDependentsMap(workspacePackages);
  const packageByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const packageByRelativePath = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.relativePath, workspacePackage]),
  );

  const normalizedChangedFiles = Array.from(
    new Set(
      changedFiles
        .map((filePath) => normalizeRelativePath(filePath))
        .filter((filePath) => filePath !== ""),
    ),
  ).sort();

  const hasRepoWideConfigChange = normalizedChangedFiles.some((filePath) => {
    if (REPO_WIDE_FILES.has(filePath)) {
      return true;
    }

    return filePath.startsWith(".github/");
  });

  function addPackageReason(packageName: string, reason: string): void {
    if (selectedPackageNames.has(packageName) === false) {
      selectedPackageNames.add(packageName);
      packageReasons.set(packageName, []);
    }

    const reasons = packageReasons.get(packageName);
    if (reasons !== undefined && reasons.includes(reason) === false) {
      reasons.push(reason);
    }
  }

  if (hasRepoWideConfigChange) {
    for (const workspacePackage of workspacePackages) {
      addPackageReason(workspacePackage.name, ALL_PACKAGES_REASON);
    }
  }

  for (const filePath of normalizedChangedFiles) {
    const matchingPackage = Array.from(packageByRelativePath.values()).find(
      (workspacePackage) =>
        filePath === workspacePackage.relativePath ||
        filePath.startsWith(`${workspacePackage.relativePath}/`),
    );

    if (matchingPackage === undefined) {
      continue;
    }

    addPackageReason(matchingPackage.name, `changed file in ${matchingPackage.relativePath}`);

    for (const dependentName of collectTransitiveDependents(matchingPackage.name, dependentsMap)) {
      addPackageReason(dependentName, `depends on ${matchingPackage.name}`);
    }
  }

  const hasRootOrScriptFileChange = normalizedChangedFiles.some(
    (filePath) =>
      filePath.startsWith("scripts/") ||
      (filePath.includes("/") === false && REPO_WIDE_FILES.has(filePath) === false),
  );

  maybeAddCommand(
    extraCommands.format,
    ["pnpm", "format:check"],
    steps.includes("format") && hasRootOrScriptFileChange,
  );
  maybeAddCommand(
    extraCommands.typecheck,
    ["pnpm", "typecheck:scripts"],
    steps.includes("typecheck") &&
      normalizedChangedFiles.some((filePath) => filePath.startsWith("scripts/")),
  );
  maybeAddCommand(
    extraCommands.lint,
    ["pnpm", "lint:openapi"],
    steps.includes("lint") &&
      normalizedChangedFiles.some((filePath) => {
        return (
          filePath.startsWith("apps/control-plane-api/") ||
          filePath.startsWith("apps/data-plane-api/") ||
          filePath.startsWith("packages/control-plane-internal-client/") ||
          filePath.startsWith("packages/data-plane-internal-client/")
        );
      }),
  );
  maybeAddCommand(
    extraCommands.lint,
    ["pnpm", "lint:sql"],
    steps.includes("lint") &&
      normalizedChangedFiles.some((filePath) => filePath.startsWith("packages/db/")),
  );

  const selectedPackages = Array.from(selectedPackageNames)
    .map((packageName) => packageByName.get(packageName))
    .filter(
      (workspacePackage): workspacePackage is WorkspacePackage => workspacePackage !== undefined,
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    allPackagesSelected: hasRepoWideConfigChange,
    changedFiles: normalizedChangedFiles,
    extraCommands,
    packageReasons,
    selectedPackages,
  };
}

function buildStepCommand(
  step: Step,
  workspacePackages: readonly WorkspacePackage[],
): string[] | null {
  const packagesWithStep = workspacePackages.filter((workspacePackage) =>
    workspacePackage.policySteps.includes(step),
  );
  if (packagesWithStep.length === 0) {
    return null;
  }

  const command = ["pnpm"];
  for (const workspacePackage of packagesWithStep) {
    command.push("--filter", workspacePackage.name);
  }
  command.push(step);
  return command;
}

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

function printPlan(plan: ValidationPlan, steps: readonly Step[], dryRun: boolean): void {
  if (dryRun) {
    console.log(`Changed files (${String(plan.changedFiles.length)}):`);
    if (plan.changedFiles.length === 0) {
      console.log("  - none");
    } else {
      for (const filePath of plan.changedFiles) {
        console.log(`  - ${filePath}`);
      }
    }

    console.log("");
    console.log(`Selected packages (${String(plan.selectedPackages.length)}):`);
    if (plan.selectedPackages.length === 0) {
      console.log("  - none");
    } else {
      for (const workspacePackage of plan.selectedPackages) {
        const reasons = plan.packageReasons.get(workspacePackage.name) ?? [];
        console.log(`  - ${workspacePackage.name} (${workspacePackage.relativePath})`);
        for (const reason of reasons) {
          console.log(`    reason: ${reason}`);
        }
      }
    }

    console.log("");
  }

  console.log(`Execution plan (${steps.join(", ")}):`);
  for (const step of steps) {
    const packageCommand = buildStepCommand(step, plan.selectedPackages);
    if (packageCommand !== null) {
      console.log(`  - ${formatCommand(packageCommand)}`);
    }

    for (const extraCommand of plan.extraCommands[step]) {
      console.log(`  - ${formatCommand(extraCommand)}`);
    }

    if (packageCommand === null && plan.extraCommands[step].length === 0) {
      console.log(`  - no ${step} commands`);
    }
  }
}

function runCommand(command: readonly string[]): void {
  const [program, ...args] = command;
  if (program === undefined) {
    throw new Error("Attempted to run an empty command.");
  }

  const result = spawnSync(program, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${formatCommand(command)}`);
  }
}

function main(): void {
  const { baseRef, changedFilesOverride, dryRun, headRef, steps } = parseArgs(
    process.argv.slice(2),
  );
  const changedFiles =
    changedFilesOverride ??
    (baseRef === null || headRef === null
      ? getChangedFilesFromWorkingTree()
      : getChangedFilesFromBranchComparison(baseRef, headRef));

  if (changedFiles.length === 0) {
    console.log("No changed files detected. Nothing to validate.");
    return;
  }

  const workspacePackages = loadWorkspacePackages();
  const plan = createValidationPlan(changedFiles, steps, workspacePackages);

  printPlan(plan, steps, dryRun);

  if (dryRun) {
    return;
  }

  for (const step of steps) {
    const packageCommand = buildStepCommand(step, plan.selectedPackages);
    if (packageCommand !== null) {
      runCommand(packageCommand);
    }

    for (const extraCommand of plan.extraCommands[step]) {
      runCommand(extraCommand);
    }
  }
}

main();
