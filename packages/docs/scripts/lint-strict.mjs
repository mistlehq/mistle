import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const docsRoot = new URL("..", import.meta.url);

function lintIntegrationGuideIcons() {
  const guidesDirectory = new URL("guides/", docsRoot);
  const failures = [];

  for (const fileName of readdirSync(guidesDirectory)) {
    if (!fileName.endsWith("-integration-setup.mdx")) {
      continue;
    }

    const filePath = new URL(fileName, guidesDirectory);
    const fileContents = readFileSync(filePath, "utf8");
    const frontmatterMatch = /^---\n([\s\S]*?)\n---/u.exec(fileContents);
    const iconMatch = frontmatterMatch?.[1].match(/^icon:\s*(.+)$/mu);

    if (!iconMatch) {
      failures.push(`${join("guides", fileName)} is missing icon frontmatter.`);
      continue;
    }

    const iconPath = iconMatch[1].trim();
    if (!iconPath.startsWith("/icons/integrations/")) {
      failures.push(
        `${join("guides", fileName)} must use a checked-in integration icon, not ${iconPath}.`,
      );
      continue;
    }

    if (!existsSync(new URL(`.${iconPath}`, docsRoot))) {
      failures.push(`${join("guides", fileName)} references missing icon ${iconPath}.`);
    }
  }

  if (failures.length > 0) {
    console.error("Integration guide icon lint failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

function runMintCommand(args, label) {
  const result = spawnSync("pnpm", ["exec", "mint", ...args], {
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = `${stdout}${stderr}`;

  if (stdout.length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  if (/\bWARN\b/u.test(output)) {
    console.error(`Mint ${label} emitted warnings; failing lint.`);
    process.exit(1);
  }
}

lintIntegrationGuideIcons();
runMintCommand(["broken-links"], "broken-links");
runMintCommand(["a11y"], "a11y");
