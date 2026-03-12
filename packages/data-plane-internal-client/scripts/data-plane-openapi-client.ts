import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolvePaths(): {
  dataPlaneInternalSpecPath: string;
  generatedSchemaPath: string;
} {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptsDirectory = dirname(scriptPath);
  const packageRoot = resolve(scriptsDirectory, "..");
  const workspaceRoot = resolve(packageRoot, "../..");

  return {
    dataPlaneInternalSpecPath: resolve(
      workspaceRoot,
      "apps/data-plane-api/openapi/data-plane.internal.v1.json",
    ),
    generatedSchemaPath: resolve(packageRoot, "src/generated/schema.ts"),
  };
}

function runOpenApiTypescript(input: { internalSpecPath: string; outputPath: string }): void {
  const result = spawnSync(
    "pnpm",
    ["exec", "openapi-typescript", input.internalSpecPath, "--alphabetize", "-o", input.outputPath],
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

export async function generateDataPlaneInternalSchemaFile(): Promise<{
  dataPlaneInternalSpecPath: string;
  generatedSchemaPath: string;
}> {
  const { dataPlaneInternalSpecPath, generatedSchemaPath } = resolvePaths();
  await access(dataPlaneInternalSpecPath, constants.R_OK);
  runOpenApiTypescript({
    internalSpecPath: dataPlaneInternalSpecPath,
    outputPath: generatedSchemaPath,
  });
  runOxfmt(generatedSchemaPath);

  return {
    dataPlaneInternalSpecPath,
    generatedSchemaPath,
  };
}

export async function generateDataPlaneInternalSchemaToTemporarySource(): Promise<{
  dataPlaneInternalSpecPath: string;
  generatedSchemaPath: string;
  schemaSource: string;
}> {
  const { dataPlaneInternalSpecPath, generatedSchemaPath } = resolvePaths();
  await access(dataPlaneInternalSpecPath, constants.R_OK);

  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "mistle-data-plane-internal-openapi-"),
  );
  const temporaryOutputPath = resolve(temporaryDirectory, "schema.ts");
  try {
    runOpenApiTypescript({
      internalSpecPath: dataPlaneInternalSpecPath,
      outputPath: temporaryOutputPath,
    });
    runOxfmt(temporaryOutputPath);
    const schemaSource = await readFile(temporaryOutputPath, "utf8");
    return {
      dataPlaneInternalSpecPath,
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
