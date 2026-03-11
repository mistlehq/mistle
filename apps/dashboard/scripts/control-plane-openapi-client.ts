import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolvePaths(): {
  controlPlaneSpecPath: string;
  generatedSchemaPath: string;
} {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptsDirectory = dirname(scriptPath);
  const dashboardRoot = resolve(scriptsDirectory, "..");
  const workspaceRoot = resolve(dashboardRoot, "../..");

  return {
    controlPlaneSpecPath: resolve(
      workspaceRoot,
      "apps/control-plane/openapi/control-plane.v1.json",
    ),
    generatedSchemaPath: resolve(dashboardRoot, "src/lib/control-plane-api/generated/schema.ts"),
  };
}

function runOpenApiTypescript(input: { controlPlaneSpecPath: string; outputPath: string }): void {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "openapi-typescript",
      input.controlPlaneSpecPath,
      "--alphabetize",
      "-o",
      input.outputPath,
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      ["openapi-typescript generation failed.", result.stderr.trim(), result.stdout.trim()]
        .filter((line) => line.length > 0)
        .join("\n"),
    );
  }
}

function runOxfmt(outputPath: string): void {
  const result = spawnSync("pnpm", ["exec", "oxfmt", outputPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      [
        "oxfmt formatting failed for generated OpenAPI schema.",
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );
  }
}

export async function generateControlPlaneSchemaFile(): Promise<{
  controlPlaneSpecPath: string;
  generatedSchemaPath: string;
}> {
  const { controlPlaneSpecPath, generatedSchemaPath } = resolvePaths();
  await access(controlPlaneSpecPath, constants.R_OK);
  runOpenApiTypescript({
    controlPlaneSpecPath,
    outputPath: generatedSchemaPath,
  });
  runOxfmt(generatedSchemaPath);

  return {
    controlPlaneSpecPath,
    generatedSchemaPath,
  };
}

export async function generateControlPlaneSchemaToTemporarySource(): Promise<{
  controlPlaneSpecPath: string;
  generatedSchemaPath: string;
  schemaSource: string;
}> {
  const { controlPlaneSpecPath, generatedSchemaPath } = resolvePaths();
  await access(controlPlaneSpecPath, constants.R_OK);

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "mistle-dashboard-openapi-"));
  const temporaryOutputPath = resolve(temporaryDirectory, "schema.ts");
  try {
    runOpenApiTypescript({
      controlPlaneSpecPath,
      outputPath: temporaryOutputPath,
    });
    runOxfmt(temporaryOutputPath);
    const schemaSource = await readFile(temporaryOutputPath, "utf8");
    return {
      controlPlaneSpecPath,
      generatedSchemaPath,
      schemaSource,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function readGeneratedSchemaFile(generatedSchemaPath: string): Promise<string | null> {
  try {
    return await readFile(generatedSchemaPath, "utf8");
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
