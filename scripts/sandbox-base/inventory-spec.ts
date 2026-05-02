export type SandboxBaseInventoryToolCategory = {
  id: string;
  title: string;
};

export type SandboxBaseInventoryToolSpec = {
  category: SandboxBaseInventoryToolCategory;
  command: string;
  displayName: string;
  dockerfileAssertions: readonly SandboxBaseDockerfileAssertion[];
  versionCommand: readonly string[];
  versionParser: (output: string) => string;
};

export type SandboxBaseDockerfileAssertion =
  | {
      kind: "apt-package";
      packageName: string;
      stageName: string;
    }
  | {
      kind: "copy-from-stage";
      fromStageName: string;
      sourcePath: string;
      stageName: string;
      targetPath: string;
    }
  | {
      kind: "run-contains";
      expectedText: string;
      stageName: string;
    }
  | {
      kind: "symlink";
      sourcePath: string;
      stageName: string;
      targetPath: string;
    };

export type SandboxBaseInventorySpec = {
  defaultImageRef: string;
  dockerfilePath: string;
  inventoryPath: string;
  packageManagerCommands: readonly string[];
  tools: readonly SandboxBaseInventoryToolSpec[];
};

export const SandboxBaseToolCategories = {
  RUNTIMES: {
    id: "runtimes",
    title: "Runtimes",
  },
  PACKAGE_AND_ENVIRONMENT: {
    id: "package-and-environment",
    title: "Package and environment",
  },
  CONTAINERS: {
    id: "containers",
    title: "Containers",
  },
  CLI_UTILITIES: {
    id: "cli-utilities",
    title: "CLI utilities",
  },
  DEBUGGING_AND_SYSTEM: {
    id: "debugging-and-system",
    title: "Debugging and system",
  },
} satisfies Record<string, SandboxBaseInventoryToolCategory>;

const SandboxBaseCommonStage = "sandbox-base-common";
const SandboxBaseToolingStage = "sandbox-base-tooling";
const SandboxBaseStage = "sandbox-base";

export const SandboxBaseInventorySpec = {
  defaultImageRef: "mistle/sandbox-base-inventory:local",
  dockerfilePath: "packages/sandboxd/Dockerfile",
  inventoryPath: "packages/sandboxd/sandbox-base-inventory.generated.json",
  packageManagerCommands: ["apt-get", "apt", "apk", "dnf", "yum", "pacman", "brew"],
  tools: [
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "mise",
      displayName: "mise",
      dockerfileAssertions: [
        runContains(SandboxBaseCommonStage, "https://mise.run"),
        symlink("/opt/mistle/bin/mise", "/usr/local/bin/mise", SandboxBaseCommonStage),
      ],
      versionCommand: ["mise", "--version"],
      versionParser: parseFirstToken,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "archil",
      displayName: "Archil",
      dockerfileAssertions: [
        runContains(SandboxBaseToolingStage, "https://archil.com/install"),
        symlink("/usr/bin/archil", "/opt/mistle/bin/archil", SandboxBaseToolingStage),
      ],
      versionCommand: ["archil", "--version"],
      versionParser: parseArchilVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "cat",
      displayName: "cat",
      dockerfileAssertions: [aptPackage("coreutils", SandboxBaseCommonStage)],
      versionCommand: ["cat", "--version"],
      versionParser: parseGnuToolVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "sed",
      displayName: "sed",
      dockerfileAssertions: [aptPackage("sed", SandboxBaseCommonStage)],
      versionCommand: ["sed", "--version"],
      versionParser: parseGnuToolVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "awk",
      displayName: "awk",
      dockerfileAssertions: [aptPackage("gawk", SandboxBaseCommonStage)],
      versionCommand: ["awk", "--version"],
      versionParser: parseGawkVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "grep",
      displayName: "grep",
      dockerfileAssertions: [aptPackage("grep", SandboxBaseCommonStage)],
      versionCommand: ["grep", "--version"],
      versionParser: parseGnuToolVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "find",
      displayName: "find",
      dockerfileAssertions: [aptPackage("findutils", SandboxBaseCommonStage)],
      versionCommand: ["find", "--version"],
      versionParser: parseGnuToolVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "git",
      displayName: "Git",
      dockerfileAssertions: [aptPackage("git", SandboxBaseCommonStage)],
      versionCommand: ["git", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "curl",
      displayName: "curl",
      dockerfileAssertions: [aptPackage("curl", SandboxBaseCommonStage)],
      versionCommand: ["curl", "--version"],
      versionParser: parseSecondToken,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "jq",
      displayName: "jq",
      dockerfileAssertions: [aptPackage("jq", SandboxBaseCommonStage)],
      versionCommand: ["jq", "--version"],
      versionParser: parseJqVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "rg",
      displayName: "ripgrep",
      dockerfileAssertions: [aptPackage("ripgrep", SandboxBaseCommonStage)],
      versionCommand: ["rg", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "tini",
      displayName: "tini",
      dockerfileAssertions: [aptPackage("tini", SandboxBaseCommonStage)],
      versionCommand: ["tini", "--version"],
      versionParser: parseTrailingVersion,
    },
  ],
} satisfies SandboxBaseInventorySpec;

function aptPackage(
  packageName: string,
  stageName = SandboxBaseStage,
): SandboxBaseDockerfileAssertion {
  return {
    kind: "apt-package",
    packageName,
    stageName,
  };
}

function runContains(stageName: string, expectedText: string): SandboxBaseDockerfileAssertion {
  return {
    expectedText,
    kind: "run-contains",
    stageName,
  };
}

function symlink(
  sourcePath: string,
  targetPath: string,
  stageName = SandboxBaseStage,
): SandboxBaseDockerfileAssertion {
  return {
    kind: "symlink",
    sourcePath,
    stageName,
    targetPath,
  };
}

function parseFirstLine(output: string): string {
  const line = output.trim().split("\n")[0]?.trim();

  if (line === undefined || line.length === 0) {
    throw new Error("Expected version command to print at least one line.");
  }

  return line;
}

function parseFirstToken(output: string): string {
  return parseRequiredToken(output, 0);
}

function parseSecondToken(output: string): string {
  return parseRequiredToken(output, 1);
}

function parseLastToken(output: string): string {
  const tokens = parseFirstLine(output).split(/\s+/u);
  const token = tokens[tokens.length - 1];

  if (token === undefined || token.length === 0) {
    throw new Error(`Could not parse version from output: ${output}`);
  }

  return token;
}

function parseRequiredToken(output: string, index: number): string {
  const token = parseFirstLine(output).split(/\s+/u)[index];

  if (token === undefined || token.length === 0) {
    throw new Error(`Could not parse token ${String(index)} from output: ${output}`);
  }

  return token;
}

function parseTrailingVersion(output: string): string {
  return parseLastToken(output).replace(/^v/u, "");
}

function parseJqVersion(output: string): string {
  return parseFirstLine(output).replace(/^jq-/u, "");
}

function parseGnuToolVersion(output: string): string {
  const versionMatch = /\b\d+(?:\.\d+)+\b/u.exec(parseFirstLine(output));

  if (versionMatch === null) {
    throw new Error(`Could not parse GNU tool version from output: ${output}`);
  }

  return versionMatch[0];
}

function parseGawkVersion(output: string): string {
  const versionMatch = /^GNU Awk\s+(\S+)/u.exec(parseFirstLine(output));

  if (versionMatch === null || versionMatch[1] === undefined) {
    throw new Error(`Could not parse GNU Awk version from output: ${output}`);
  }

  return versionMatch[1].replace(/,$/u, "");
}

function parseArchilVersion(output: string): string {
  const versionMatch = /^Archil Client:\s*(\S+)/u.exec(parseFirstLine(output));

  if (versionMatch === null) {
    throw new Error(`Could not parse Archil version from output: ${output}`);
  }

  const version = versionMatch[1];

  if (version === undefined) {
    throw new Error(`Could not parse Archil version from output: ${output}`);
  }

  return version.replace(/,$/u, "");
}
