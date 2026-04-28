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
const SandboxBaseStage = "sandbox-base";

export const SandboxBaseInventorySpec = {
  defaultImageRef: "mistle/sandbox-base-inventory:local",
  dockerfilePath: "packages/sandboxd/Dockerfile",
  inventoryPath: "packages/sandboxd/sandbox-base-inventory.generated.json",
  packageManagerCommands: ["apt-get", "apt", "apk", "dnf", "yum", "pacman", "brew"],
  tools: [
    {
      category: SandboxBaseToolCategories.RUNTIMES,
      command: "node",
      displayName: "Node.js",
      dockerfileAssertions: [copyFromStage("node", "/usr/local/bin/node", "/usr/local/bin/node")],
      versionCommand: ["node", "--version"],
      versionParser: parseLeadingVVersion,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "npm",
      displayName: "npm",
      dockerfileAssertions: [
        copyFromStage("node", "/usr/local/lib/node_modules", "/usr/local/lib/node_modules"),
        symlink("/usr/local/lib/node_modules/npm/bin/npm-cli.js", "/usr/local/bin/npm"),
      ],
      versionCommand: ["npm", "--version"],
      versionParser: parseFirstLine,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "npx",
      displayName: "npx",
      dockerfileAssertions: [
        copyFromStage("node", "/usr/local/lib/node_modules", "/usr/local/lib/node_modules"),
        symlink("/usr/local/lib/node_modules/npm/bin/npx-cli.js", "/usr/local/bin/npx"),
      ],
      versionCommand: ["npx", "--version"],
      versionParser: parseFirstLine,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "corepack",
      displayName: "Corepack",
      dockerfileAssertions: [
        copyFromStage("node", "/usr/local/lib/node_modules", "/usr/local/lib/node_modules"),
        symlink("/usr/local/lib/node_modules/corepack/dist/corepack.js", "/usr/local/bin/corepack"),
      ],
      versionCommand: ["corepack", "--version"],
      versionParser: parseFirstLine,
    },
    {
      category: SandboxBaseToolCategories.RUNTIMES,
      command: "python3",
      displayName: "Python",
      dockerfileAssertions: [copyFromStage("python", "/usr/local", "/usr/local")],
      versionCommand: ["python3", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "pip",
      displayName: "pip",
      dockerfileAssertions: [copyFromStage("python", "/usr/local", "/usr/local")],
      versionCommand: ["pip", "--version"],
      versionParser: parseSecondToken,
    },
    {
      category: SandboxBaseToolCategories.CONTAINERS,
      command: "docker",
      displayName: "Docker",
      dockerfileAssertions: [
        copyFromStage("docker", "/usr/local/bin/docker", "/usr/local/bin/docker"),
      ],
      versionCommand: ["docker", "--version"],
      versionParser: parseDockerVersion,
    },
    {
      category: SandboxBaseToolCategories.CONTAINERS,
      command: "docker-compose",
      displayName: "Docker Compose",
      dockerfileAssertions: [
        copyFromStage("docker", "/usr/local/bin/docker-compose", "/usr/local/bin/docker-compose"),
      ],
      versionCommand: ["docker-compose", "version", "--short"],
      versionParser: parseFirstLine,
    },
    {
      category: SandboxBaseToolCategories.CONTAINERS,
      command: "containerd",
      displayName: "containerd",
      dockerfileAssertions: [
        copyFromStage("docker", "/usr/local/bin/containerd", "/usr/local/bin/containerd"),
      ],
      versionCommand: ["containerd", "--version"],
      versionParser: parseContainerdVersion,
    },
    {
      category: SandboxBaseToolCategories.CONTAINERS,
      command: "runc",
      displayName: "runc",
      dockerfileAssertions: [copyFromStage("docker", "/usr/local/bin/runc", "/usr/local/bin/runc")],
      versionCommand: ["runc", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.PACKAGE_AND_ENVIRONMENT,
      command: "nix",
      displayName: "Nix",
      dockerfileAssertions: [
        copyFromStage("nix", "/nix", "/nix"),
        copyFromStage("nix", "/root/.nix-profile", "/root/.nix-profile"),
      ],
      versionCommand: ["nix", "--version"],
      versionParser: parseLastToken,
    },
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
        runContains(SandboxBaseStage, "https://archil.com/install"),
        symlink("/usr/bin/archil", "/opt/mistle/bin/archil"),
      ],
      versionCommand: ["archil", "--version"],
      versionParser: parseArchilVersion,
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
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "fd",
      displayName: "fd",
      dockerfileAssertions: [
        aptPackage("fd-find"),
        symlink("/usr/bin/fdfind", "/opt/mistle/bin/fd"),
      ],
      versionCommand: ["fd", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "bat",
      displayName: "bat",
      dockerfileAssertions: [aptPackage("bat"), symlink("/usr/bin/batcat", "/opt/mistle/bin/bat")],
      versionCommand: ["bat", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "tmux",
      displayName: "tmux",
      dockerfileAssertions: [aptPackage("tmux")],
      versionCommand: ["tmux", "-V"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "vim",
      displayName: "Vim",
      dockerfileAssertions: [aptPackage("vim")],
      versionCommand: ["vim", "--version"],
      versionParser: parseVimVersion,
    },
    {
      category: SandboxBaseToolCategories.CLI_UTILITIES,
      command: "sqlite3",
      displayName: "SQLite",
      dockerfileAssertions: [aptPackage("sqlite3")],
      versionCommand: ["sqlite3", "--version"],
      versionParser: parseFirstToken,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "make",
      displayName: "Make",
      dockerfileAssertions: [aptPackage("make")],
      versionCommand: ["make", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "gdb",
      displayName: "gdb",
      dockerfileAssertions: [aptPackage("gdb")],
      versionCommand: ["gdb", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "strace",
      displayName: "strace",
      dockerfileAssertions: [aptPackage("strace")],
      versionCommand: ["strace", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "tcpdump",
      displayName: "tcpdump",
      dockerfileAssertions: [aptPackage("tcpdump")],
      versionCommand: ["tcpdump", "--version"],
      versionParser: parseTrailingVersion,
    },
    {
      category: SandboxBaseToolCategories.DEBUGGING_AND_SYSTEM,
      command: "tree",
      displayName: "tree",
      dockerfileAssertions: [aptPackage("tree")],
      versionCommand: ["tree", "--version"],
      versionParser: parseSecondTokenWithoutLeadingV,
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

function copyFromStage(
  fromStageName: string,
  sourcePath: string,
  targetPath: string,
  stageName = SandboxBaseStage,
): SandboxBaseDockerfileAssertion {
  return {
    fromStageName,
    kind: "copy-from-stage",
    sourcePath,
    stageName,
    targetPath,
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

function parseSecondTokenWithoutLeadingV(output: string): string {
  return parseSecondToken(output).replace(/^v/u, "");
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

function parseLeadingVVersion(output: string): string {
  return parseFirstLine(output).replace(/^v/u, "");
}

function parseTrailingVersion(output: string): string {
  return parseLastToken(output).replace(/^v/u, "");
}

function parseDockerVersion(output: string): string {
  return parseRequiredToken(output.replaceAll(",", ""), 2);
}

function parseContainerdVersion(output: string): string {
  return parseRequiredToken(output, 2).replace(/^v/u, "");
}

function parseJqVersion(output: string): string {
  return parseFirstLine(output).replace(/^jq-/u, "");
}

function parseVimVersion(output: string): string {
  const versionMatch = /\b\d+\.\d+\b/u.exec(parseFirstLine(output));

  if (versionMatch === null) {
    throw new Error(`Could not parse Vim version from output: ${output}`);
  }

  return versionMatch[0];
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
