import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Step = "format" | "lint" | "typecheck" | "test";
type Command = string[];

type WorkspacePackage = {
  dependencies: Set<string>;
  name: string;
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
  changedFiles: string[];
  extraCommands: Record<Step, string[][]>;
  packageReasons: Map<string, string[]>;
  selectedPackages: WorkspacePackage[];
};

type PackageSelection = {
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
const ROOT_REPO_CHECK_STEPS = new Set<Step>(["format", "typecheck"]);
const AFFECTED_TEST_PACKAGE_NAMES = new Set(["@mistle/dashboard", "@mistle/ui"]);

const ALL_PACKAGES_REASON = "root-level or repo-wide config changed";

const REPO_WIDE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  ".lintstagedrc.json",
]);

function requireFlagValue(argv: readonly string[], index: number, flagName: string): string {
  const nextValue = argv[index + 1];
  if (nextValue === undefined) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return nextValue;
}

function parseStepList(rawValue: string): Step[] {
  const parsedSteps = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is Step => VALIDATION_STEPS.includes(value as Step));

  if (parsedSteps.length === 0) {
    throw new Error("Expected at least one valid step in --steps.");
  }

  return parsedSteps;
}

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
      baseRef = requireFlagValue(argv, index, "--base");
      index += 1;
      continue;
    }

    if (argument === "--head") {
      headRef = requireFlagValue(argv, index, "--head");
      index += 1;
      continue;
    }

    if (argument === "--files") {
      changedFilesOverride = requireFlagValue(argv, index, "--files")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      index += 1;
      continue;
    }

    if (argument === "--steps") {
      steps = parseStepList(requireFlagValue(argv, index, "--steps"));
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

function runGitLineCommand(args: readonly string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getChangedFilesFromBranchComparison(baseRef: string, headRef: string): string[] {
  return runGitLineCommand(["diff", "--name-only", `${baseRef}...${headRef}`]);
}

function getChangedFilesFromWorkingTree(): string[] {
  return Array.from(
    new Set(
      [
        runGitLineCommand(["diff", "--name-only"]),
        runGitLineCommand(["diff", "--name-only", "--cached"]),
        runGitLineCommand(["ls-files", "--others", "--exclude-standard"]),
      ].flat(),
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

function collectTransitiveDependencies(
  packageName: string,
  packageByName: ReadonlyMap<string, WorkspacePackage>,
): Set<string> {
  const collected = new Set<string>();
  const queue = [packageName];

  while (queue.length > 0) {
    const nextPackage = queue.shift();
    if (nextPackage === undefined) {
      continue;
    }

    const workspacePackage = packageByName.get(nextPackage);
    if (workspacePackage === undefined) {
      continue;
    }

    for (const dependencyName of workspacePackage.dependencies) {
      if (collected.has(dependencyName)) {
        continue;
      }

      collected.add(dependencyName);
      queue.push(dependencyName);
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

function maybeAddCommand(commands: Command[], command: readonly string[], enabled: boolean): void {
  if (enabled) {
    commands.push([...command]);
  }
}

function isRootRepoCheckStep(step: Step): boolean {
  return ROOT_REPO_CHECK_STEPS.has(step);
}

function isRepoWideConfigPath(filePath: string): boolean {
  return filePath.startsWith(".github/") || filePath.includes("/") === false;
}

function normalizeChangedFiles(changedFiles: readonly string[]): string[] {
  return Array.from(
    new Set(
      changedFiles
        .map((filePath) => normalizeRelativePath(filePath))
        .filter((filePath) => filePath !== ""),
    ),
  ).sort();
}

function findWorkspacePackageForFile(
  filePath: string,
  workspacePackages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return workspacePackages.find(
    (workspacePackage) =>
      filePath === workspacePackage.relativePath ||
      filePath.startsWith(`${workspacePackage.relativePath}/`),
  );
}

function addPackageReason(
  packageReasons: Map<string, string[]>,
  selectedPackageNames: Set<string>,
  packageName: string,
  reason: string,
): void {
  if (selectedPackageNames.has(packageName) === false) {
    selectedPackageNames.add(packageName);
    packageReasons.set(packageName, []);
  }

  const reasons = packageReasons.get(packageName);
  if (reasons !== undefined && reasons.includes(reason) === false) {
    reasons.push(reason);
  }
}

function getLintRepoCheckCommands(
  changedFiles: readonly string[],
  steps: readonly Step[],
): Command[] {
  const commands: Command[] = [];

  maybeAddCommand(
    commands,
    ["pnpm", "lint:openapi"],
    steps.includes("lint") &&
      changedFiles.some((filePath) => {
        return (
          filePath.startsWith("apps/control-plane-api/") ||
          filePath.startsWith("apps/data-plane-api/") ||
          filePath.startsWith("packages/control-plane-internal-client/") ||
          filePath.startsWith("packages/data-plane-internal-client/")
        );
      }),
  );

  maybeAddCommand(
    commands,
    ["pnpm", "lint:sql"],
    steps.includes("lint") && changedFiles.some((filePath) => filePath.startsWith("packages/db/")),
  );

  return commands;
}

function selectWorkspacePackages(
  changedFiles: readonly string[],
  workspacePackages: readonly WorkspacePackage[],
): PackageSelection {
  const packageReasons = new Map<string, string[]>();
  const selectedPackageNames = new Set<string>();
  const dependentsMap = buildDependentsMap(workspacePackages);
  const packageByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const hasRepoWideConfigChange = changedFiles.some((filePath) => isRepoWideConfigPath(filePath));

  if (hasRepoWideConfigChange) {
    for (const workspacePackage of workspacePackages) {
      addPackageReason(
        packageReasons,
        selectedPackageNames,
        workspacePackage.name,
        ALL_PACKAGES_REASON,
      );
    }
  }

  for (const filePath of changedFiles) {
    const matchingPackage = findWorkspacePackageForFile(filePath, workspacePackages);

    if (matchingPackage === undefined) {
      continue;
    }

    addPackageReason(
      packageReasons,
      selectedPackageNames,
      matchingPackage.name,
      `changed file in ${matchingPackage.relativePath}`,
    );

    for (const dependentName of collectTransitiveDependents(matchingPackage.name, dependentsMap)) {
      addPackageReason(
        packageReasons,
        selectedPackageNames,
        dependentName,
        `depends on ${matchingPackage.name}`,
      );
    }
  }

  const selectedPackages = Array.from(selectedPackageNames)
    .map((packageName) => packageByName.get(packageName))
    .filter(
      (workspacePackage): workspacePackage is WorkspacePackage => workspacePackage !== undefined,
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    packageReasons,
    selectedPackages,
  };
}

function createValidationPlan(
  changedFiles: readonly string[],
  steps: readonly Step[],
  workspacePackages: readonly WorkspacePackage[],
): ValidationPlan {
  const extraCommands = createEmptyExtraCommands();
  const normalizedChangedFiles = normalizeChangedFiles(changedFiles);
  const packageSelection = selectWorkspacePackages(normalizedChangedFiles, workspacePackages);

  extraCommands.lint.push(...getLintRepoCheckCommands(normalizedChangedFiles, steps));

  return {
    changedFiles: normalizedChangedFiles,
    extraCommands,
    packageReasons: packageSelection.packageReasons,
    selectedPackages: packageSelection.selectedPackages,
  };
}

function buildWorkspaceTurboCommand(
  step: Extract<Step, "lint" | "test">,
  workspacePackages: readonly WorkspacePackage[],
): string[] | null {
  if (
    workspacePackages.some((workspacePackage) => workspacePackage.policySteps.includes(step)) ===
    false
  ) {
    return null;
  }

  const selectedPackageNames = Array.from(
    new Set(
      workspacePackages
        .filter((workspacePackage) => workspacePackage.policySteps.includes(step))
        .map((workspacePackage) => workspacePackage.name),
    ),
  ).sort();

  const command = ["turbo", "run", step, "--output-logs=errors-only"];
  for (const packageName of selectedPackageNames) {
    command.push("--filter", packageName);
  }

  return command;
}

function isTestFilePath(filePath: string): boolean {
  return filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx");
}

function isSupportedAffectedTestInputFilePath(filePath: string): boolean {
  return /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(filePath);
}

function buildPackageByNameMap(
  workspacePackages: readonly WorkspacePackage[],
): Map<string, WorkspacePackage> {
  return new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
}

function getAffectedTestRelevantFiles(
  workspacePackage: WorkspacePackage,
  changedFiles: readonly string[],
  workspacePackages: readonly WorkspacePackage[],
): string[] {
  const packageByName = buildPackageByNameMap(workspacePackages);
  const relevantPackageNames = collectTransitiveDependencies(workspacePackage.name, packageByName);
  relevantPackageNames.add(workspacePackage.name);

  return changedFiles.filter((filePath) => {
    const matchingPackage = findWorkspacePackageForFile(filePath, workspacePackages);
    return matchingPackage !== undefined && relevantPackageNames.has(matchingPackage.name);
  });
}

function buildAffectedVitestCommand(
  workspacePackage: WorkspacePackage,
  vitestCommand: "related" | "run",
  filePaths: readonly string[],
): string[] {
  const command = ["pnpm", "--dir", workspacePackage.relativePath, "exec", "vitest", vitestCommand];

  if (vitestCommand === "related") {
    command.push("--run");
  }

  command.push("--passWithNoTests");
  command.push(...filePaths.map((filePath) => resolve(REPO_ROOT, filePath)));

  return command;
}

function buildAffectedTestCommands(
  plan: ValidationPlan,
  workspacePackages: readonly WorkspacePackage[],
): { commands: Command[]; turboPackages: WorkspacePackage[] } {
  const affectedCommands: Command[] = [];
  const turboPackages: WorkspacePackage[] = [];

  for (const workspacePackage of plan.selectedPackages) {
    if (
      workspacePackage.policySteps.includes("test") === false ||
      AFFECTED_TEST_PACKAGE_NAMES.has(workspacePackage.name) === false
    ) {
      turboPackages.push(workspacePackage);
      continue;
    }

    const reasons = plan.packageReasons.get(workspacePackage.name) ?? [];
    if (reasons.includes(ALL_PACKAGES_REASON)) {
      turboPackages.push(workspacePackage);
      continue;
    }

    const relevantFiles = getAffectedTestRelevantFiles(
      workspacePackage,
      plan.changedFiles,
      workspacePackages,
    );

    if (relevantFiles.length === 0) {
      turboPackages.push(workspacePackage);
      continue;
    }

    const changedTestFiles = relevantFiles.filter(
      (filePath) =>
        filePath.startsWith(`${workspacePackage.relativePath}/`) && isTestFilePath(filePath),
    );
    const relatedFiles = relevantFiles.filter(
      (filePath) => changedTestFiles.includes(filePath) === false,
    );
    const hasUnsupportedRelevantFile = relatedFiles.some(
      (filePath) => isSupportedAffectedTestInputFilePath(filePath) === false,
    );

    if (hasUnsupportedRelevantFile) {
      turboPackages.push(workspacePackage);
      continue;
    }

    if (changedTestFiles.length > 0) {
      affectedCommands.push(buildAffectedVitestCommand(workspacePackage, "run", changedTestFiles));
    }

    if (relatedFiles.length > 0) {
      affectedCommands.push(buildAffectedVitestCommand(workspacePackage, "related", relatedFiles));
    }

    if (changedTestFiles.length === 0 && relatedFiles.length === 0) {
      turboPackages.push(workspacePackage);
    }
  }

  return {
    commands: affectedCommands,
    turboPackages,
  };
}

function buildExecutionCommands(plan: ValidationPlan, steps: readonly Step[]): string[][] {
  const commands: Command[] = [];

  for (const step of steps) {
    if (isRootRepoCheckStep(step) && plan.changedFiles.length > 0) {
      commands.push(["pnpm", step]);
    }
  }

  if (steps.includes("lint")) {
    const lintCommand = buildWorkspaceTurboCommand("lint", plan.selectedPackages);
    if (lintCommand !== null) {
      commands.push(lintCommand);
    }
  }

  if (steps.includes("test")) {
    const affectedTestPlan = buildAffectedTestCommands(plan, plan.selectedPackages);
    const testCommand = buildWorkspaceTurboCommand("test", affectedTestPlan.turboPackages);
    if (testCommand !== null) {
      commands.push(testCommand);
    }

    commands.push(...affectedTestPlan.commands);
  }

  for (const step of steps) {
    if (step === "format") {
      continue;
    }

    for (const extraCommand of plan.extraCommands[step]) {
      commands.push(extraCommand);
    }
  }

  return commands;
}

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

function getPlannedStepsForPackage(
  workspacePackage: WorkspacePackage,
  steps: readonly Step[],
): Step[] {
  return steps.filter((step) => workspacePackage.policySteps.includes(step));
}

function getWorkspacePlanSteps(workspacePackage: WorkspacePackage, steps: readonly Step[]): Step[] {
  return getPlannedStepsForPackage(workspacePackage, steps).filter(
    (step) => isRootRepoCheckStep(step) === false,
  );
}

function groupWorkspaceChecks(
  workspacePackages: readonly WorkspacePackage[],
  steps: readonly Step[],
): Map<string, string[]> {
  const groupedPackages = new Map<string, string[]>();

  for (const workspacePackage of workspacePackages) {
    const workspacePlannedSteps = getWorkspacePlanSteps(workspacePackage, steps);
    if (workspacePlannedSteps.length === 0) {
      continue;
    }

    const groupingKey = workspacePlannedSteps.join(", ");
    const groupedPackageNames = groupedPackages.get(groupingKey) ?? [];
    groupedPackageNames.push(workspacePackage.name);
    groupedPackages.set(groupingKey, groupedPackageNames);
  }

  return groupedPackages;
}

function getRepoCheckLabels(step: Step, plan: ValidationPlan): string[] {
  if (isRootRepoCheckStep(step) && plan.changedFiles.length > 0) {
    return [step];
  }

  return plan.extraCommands[step].map((command) => {
    if (command[0] === "pnpm" && typeof command[1] === "string") {
      return command[1];
    }

    return formatCommand(command);
  });
}

function getAllRepoCheckLabels(plan: ValidationPlan, steps: readonly Step[]): string[] {
  return steps.flatMap((step) => getRepoCheckLabels(step, plan));
}

function printDryRunDetails(plan: ValidationPlan): void {
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

function printPlan(plan: ValidationPlan, steps: readonly Step[], dryRun: boolean): void {
  if (dryRun) {
    printDryRunDetails(plan);
  }

  console.log(`Validation plan (${steps.join(", ")}):`);
  const groupedPackages = groupWorkspaceChecks(plan.selectedPackages, steps);
  const hasWorkspaceChecks = groupedPackages.size > 0;
  const repoCheckLabels = getAllRepoCheckLabels(plan, steps);
  const hasRepoChecks = repoCheckLabels.length > 0;

  if (hasWorkspaceChecks) {
    console.log("  Workspace checks:");
  }
  for (const [groupingKey, packageNames] of groupedPackages.entries()) {
    console.log(
      `    - ${groupingKey}: ${packageNames.sort((left, right) => left.localeCompare(right)).join(", ")}`,
    );
  }

  if (hasRepoChecks) {
    console.log("  Repo checks:");
    console.log(`    - ${repoCheckLabels.join(", ")}`);
  }

  if (hasWorkspaceChecks === false && hasRepoChecks === false) {
    console.log("  - none");
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

  const commands = buildExecutionCommands(plan, steps);

  for (const command of commands) {
    runCommand(command);
  }

  console.log(
    `Validation passed. Completed ${String(commands.length)} command${commands.length === 1 ? "" : "s"}.`,
  );
}

main();
