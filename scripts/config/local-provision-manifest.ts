import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ScriptDirectoryPath = fileURLToPath(new URL(".", import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");

const SourceManifestPath = resolve(
  RepositoryRootPath,
  "integration-targets.provision.example.json",
);
const GeneratedManifestPath = resolve(
  RepositoryRootPath,
  "deploy/compose/local/config/integration-targets.provision.json",
);

function canonicalizeManifestJson(rawContent: string): string {
  const parsed = JSON.parse(rawContent);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function formatManifestJson(rawContent: string): string {
  return execFileSync("pnpm", ["exec", "oxfmt", "--stdin-filepath", GeneratedManifestPath], {
    cwd: RepositoryRootPath,
    encoding: "utf8",
    input: rawContent,
  });
}

async function readCanonicalSourceManifest(): Promise<string> {
  const sourceManifestContent = await readFile(SourceManifestPath, "utf8");
  return formatManifestJson(canonicalizeManifestJson(sourceManifestContent));
}

async function generateLocalProvisionManifest(): Promise<void> {
  const generatedManifestContent = await readCanonicalSourceManifest();
  await writeFile(GeneratedManifestPath, generatedManifestContent, "utf8");
  console.log(`Updated ${GeneratedManifestPath} from ${SourceManifestPath}.`);
}

async function checkLocalProvisionManifest(): Promise<void> {
  const expectedManifestContent = await readCanonicalSourceManifest();
  const actualManifestContent = await readFile(GeneratedManifestPath, "utf8");

  if (actualManifestContent !== expectedManifestContent) {
    throw new Error(
      `Local Compose integration target manifest is stale. Run 'pnpm generate:local-provision-manifest' to refresh ${GeneratedManifestPath}.`,
    );
  }

  console.log(`Local Compose integration target manifest is current: ${GeneratedManifestPath}`);
}

function parseMode(argv: string[]): "generate" | "check" {
  const mode = argv[0];
  if (mode === "generate" || mode === "check") {
    return mode;
  }

  throw new Error("Expected first argument to be either 'generate' or 'check'.");
}

const mode = parseMode(process.argv.slice(2));

if (mode === "generate") {
  await generateLocalProvisionManifest();
} else {
  await checkLocalProvisionManifest();
}
