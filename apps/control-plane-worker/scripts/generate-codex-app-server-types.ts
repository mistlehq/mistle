import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type GitHubReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
};

type GitHubRelease = {
  tagName: string;
  assets: GitHubReleaseAsset[];
};

type SupportedCodexTargetTriple =
  | "aarch64-apple-darwin"
  | "x86_64-apple-darwin"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-unknown-linux-gnu";

type RunCommandInput = {
  command: string;
  args: readonly string[];
  cwd?: string;
};

const CodexRepository = "openai/codex";
const CodexLatestReleaseApiUrl = `https://api.github.com/repos/${CodexRepository}/releases/latest`;
const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const AppRootPath = resolve(ScriptDirectoryPath, "..");
const GeneratedTypesOutputPath = resolve(
  AppRootPath,
  "src",
  "runtime",
  "conversations",
  "providers",
  "generated",
  "codex-app-server-ts",
);
const GeneratedJsonSchemaOutputPath = resolve(
  AppRootPath,
  "src",
  "runtime",
  "conversations",
  "providers",
  "generated",
  "codex-app-server-json-schema",
);
const ScriptUserAgent = "mistle-codex-app-server-types-generator";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGitHubReleaseAsset(value: unknown): GitHubReleaseAsset {
  if (!isRecord(value)) {
    throw new Error("GitHub release asset payload must be an object.");
  }

  const name = value["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("GitHub release asset is missing a valid name.");
  }

  const browserDownloadUrl = value["browser_download_url"];
  if (typeof browserDownloadUrl !== "string" || browserDownloadUrl.length === 0) {
    throw new Error(`GitHub release asset '${name}' is missing browser_download_url.`);
  }

  return {
    name,
    browserDownloadUrl,
  };
}

function parseGitHubReleasePayload(value: unknown): GitHubRelease {
  if (!isRecord(value)) {
    throw new Error("GitHub latest release payload must be an object.");
  }

  const tagName = value["tag_name"];
  if (typeof tagName !== "string" || tagName.length === 0) {
    throw new Error("GitHub latest release payload is missing tag_name.");
  }

  const assetsValue = value["assets"];
  if (!Array.isArray(assetsValue)) {
    throw new Error("GitHub latest release payload is missing assets.");
  }

  return {
    tagName,
    assets: assetsValue.map(parseGitHubReleaseAsset),
  };
}

function resolveSupportedCodexTargetTriple(): SupportedCodexTargetTriple {
  const platform = process.platform;
  const architecture = process.arch;

  if (platform === "darwin" && architecture === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (platform === "darwin" && architecture === "x64") {
    return "x86_64-apple-darwin";
  }
  if (platform === "linux" && architecture === "arm64") {
    return "aarch64-unknown-linux-gnu";
  }
  if (platform === "linux" && architecture === "x64") {
    return "x86_64-unknown-linux-gnu";
  }

  throw new Error(
    `Unsupported platform for Codex release asset selection: platform='${platform}', arch='${architecture}'.`,
  );
}

function getGithubApiHeaders(): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": ScriptUserAgent,
  });

  const githubToken = process.env["GITHUB_TOKEN"];
  if (typeof githubToken === "string" && githubToken.length > 0) {
    headers.set("Authorization", `Bearer ${githubToken}`);
  }

  return headers;
}

async function fetchLatestCodexRelease(): Promise<GitHubRelease> {
  const response = await fetch(CodexLatestReleaseApiUrl, {
    method: "GET",
    headers: getGithubApiHeaders(),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to fetch latest release for ${CodexRepository} (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  const payload: unknown = await response.json();
  return parseGitHubReleasePayload(payload);
}

async function downloadFile(input: { url: string; outputPath: string }): Promise<void> {
  const response = await fetch(input.url, {
    method: "GET",
    headers: getGithubApiHeaders(),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to download '${input.url}' (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(input.outputPath, bytes);
}

function runCommandOrThrow(input: RunCommandInput): void {
  const runResult = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (runResult.status === 0) {
    return;
  }

  const stderr = runResult.stderr ?? "";
  const stdout = runResult.stdout ?? "";
  throw new Error(
    [
      `Command failed: ${input.command} ${input.args.join(" ")}`,
      `exit_code=${String(runResult.status)}`,
      stdout.length > 0 ? `stdout:\n${stdout}` : "stdout:<empty>",
      stderr.length > 0 ? `stderr:\n${stderr}` : "stderr:<empty>",
    ].join("\n"),
  );
}

function normalizeImportSpecifier(specifier: string): string {
  if (specifier.endsWith("/v2")) {
    return `${specifier}/index.js`;
  }

  if (
    specifier.endsWith(".js") ||
    specifier.endsWith(".mjs") ||
    specifier.endsWith(".cjs") ||
    specifier.endsWith(".json")
  ) {
    return specifier;
  }
  return `${specifier}.js`;
}

function normalizeRelativeImportSpecifiers(sourceText: string): string {
  const fromSpecifierPattern = /(from\s+["'])(\.\.?\/[^"']+)(["'])/g;
  const importSpecifierPattern = /(import\s*\(\s*["'])(\.\.?\/[^"']+)(["'])/g;

  return sourceText
    .replace(fromSpecifierPattern, (_match, prefix: string, specifier: string, suffix: string) => {
      return `${prefix}${normalizeImportSpecifier(specifier)}${suffix}`;
    })
    .replace(
      importSpecifierPattern,
      (_match, prefix: string, specifier: string, suffix: string) => {
        return `${prefix}${normalizeImportSpecifier(specifier)}${suffix}`;
      },
    );
}

async function listTypeScriptFilesRecursively(directoryPath: string): Promise<string[]> {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const nestedPaths = await Promise.all(
    directoryEntries.map(async (entry): Promise<string[]> => {
      const resolvedPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFilesRecursively(resolvedPath);
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        return [resolvedPath];
      }
      return [];
    }),
  );

  return nestedPaths.flat();
}

async function normalizeGeneratedTypeScriptImports(directoryPath: string): Promise<void> {
  const typeScriptFilePaths = await listTypeScriptFilesRecursively(directoryPath);

  await Promise.all(
    typeScriptFilePaths.map(async (filePath) => {
      const currentContent = await readFile(filePath, "utf8");
      const normalizedContent = normalizeRelativeImportSpecifiers(currentContent);
      if (normalizedContent !== currentContent) {
        await writeFile(filePath, normalizedContent);
      }
    }),
  );
}

async function run(): Promise<void> {
  const targetTriple = resolveSupportedCodexTargetTriple();
  const release = await fetchLatestCodexRelease();
  const codexArchiveAssetName = `codex-${targetTriple}.tar.gz`;
  const codexArchiveAsset = release.assets.find((asset) => asset.name === codexArchiveAssetName);

  if (codexArchiveAsset === undefined) {
    const availableAssetNames = release.assets.map((asset) => asset.name).join(", ");
    throw new Error(
      `Latest release ${release.tagName} does not include required asset '${codexArchiveAssetName}'. Available assets: ${availableAssetNames}`,
    );
  }

  const workingDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-codex-app-server-types-"));
  const codexArchivePath = join(workingDirectoryPath, codexArchiveAssetName);

  try {
    console.log(`Using ${CodexRepository} release ${release.tagName}.`);
    console.log(`Downloading ${codexArchiveAssetName}...`);
    await downloadFile({
      url: codexArchiveAsset.browserDownloadUrl,
      outputPath: codexArchivePath,
    });

    console.log("Extracting codex binary archive...");
    runCommandOrThrow({
      command: "tar",
      args: ["-xzf", codexArchivePath, "-C", workingDirectoryPath],
    });

    const codexBinaryPath = join(workingDirectoryPath, `codex-${targetTriple}`);
    await chmod(codexBinaryPath, 0o755);

    await rm(GeneratedTypesOutputPath, { recursive: true, force: true });
    await rm(GeneratedJsonSchemaOutputPath, { recursive: true, force: true });
    await mkdir(GeneratedTypesOutputPath, { recursive: true });
    await mkdir(GeneratedJsonSchemaOutputPath, { recursive: true });

    console.log("Generating TypeScript app-server types...");
    runCommandOrThrow({
      command: codexBinaryPath,
      args: ["app-server", "generate-ts", "--out", GeneratedTypesOutputPath],
      cwd: AppRootPath,
    });
    await normalizeGeneratedTypeScriptImports(GeneratedTypesOutputPath);

    console.log("Generating JSON Schema bundle...");
    runCommandOrThrow({
      command: codexBinaryPath,
      args: ["app-server", "generate-json-schema", "--out", GeneratedJsonSchemaOutputPath],
      cwd: AppRootPath,
    });

    console.log("Codex app-server artifacts generated.");
    console.log(`- release: ${release.tagName}`);
    console.log(`- types: ${GeneratedTypesOutputPath}`);
    console.log(`- json-schema: ${GeneratedJsonSchemaOutputPath}`);
  } finally {
    await rm(workingDirectoryPath, { recursive: true, force: true });
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`Failed to generate Codex app-server artifacts.\n${message}`);
  process.exit(1);
});
