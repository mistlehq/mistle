import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IgnoredDirectories = new Set([".turbo", "dist", "node_modules"]);
const AllowedFileNames = new Set(["README.md"]);
const KebabCaseDirectoryPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KebabCaseFilePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

async function collectInvalidNames(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const invalidNames: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (IgnoredDirectories.has(entry.name)) {
        continue;
      }

      if (!KebabCaseDirectoryPattern.test(entry.name)) {
        invalidNames.push(`${relative(DashboardRoot, entryPath)}/`);
      }

      const nestedInvalidNames = await collectInvalidNames(entryPath);
      invalidNames.push(...nestedInvalidNames);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (AllowedFileNames.has(entry.name)) {
      continue;
    }

    if (!KebabCaseFilePattern.test(entry.name)) {
      invalidNames.push(relative(DashboardRoot, entryPath));
    }
  }

  return invalidNames;
}

async function run(): Promise<void> {
  const invalidNames = await collectInvalidNames(DashboardRoot);

  if (invalidNames.length === 0) {
    return;
  }

  const lines = invalidNames.map((filePath) => `- ${filePath}`).join("\n");
  throw new Error(`Dashboard files and folders must be kebab-case:\n${lines}`);
}

await run();
