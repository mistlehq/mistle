import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const RepositoryRootPath = fileURLToPath(new URL("../../../../", import.meta.url));
const TestContextDirectoryPath = join(RepositoryRootPath, ".local", "test-context");

const TestContextIdPattern = /^[a-z0-9][a-z0-9-_.]*$/u;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function assertValidTestContextId(id: string): string {
  if (!TestContextIdPattern.test(id)) {
    throw new Error(
      `Test context id '${id}' is invalid. Expected lowercase alphanumeric, dash, underscore, or period characters.`,
    );
  }

  return id;
}

export function resolveTestContextFilePath(id: string): string {
  return join(TestContextDirectoryPath, `${assertValidTestContextId(id)}.json`);
}

export async function writeTestContext(input: { id: string; value: JsonValue }): Promise<void> {
  const filePath = resolveTestContextFilePath(input.id);

  await mkdir(TestContextDirectoryPath, {
    recursive: true,
  });
  await writeFile(filePath, `${JSON.stringify(input.value, null, 2)}\n`, "utf8");
}

export async function readTestContext<TSchema extends z.ZodType>(input: {
  id: string;
  schema: TSchema;
}): Promise<z.infer<TSchema>> {
  const filePath = resolveTestContextFilePath(input.id);
  let fileContents: string;

  try {
    fileContents = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read test context '${input.id}' from ${filePath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Test context '${input.id}' at ${filePath} is not valid JSON: ${message}`);
  }

  return input.schema.parse(parsed);
}

export async function removeTestContext(id: string): Promise<void> {
  await rm(resolveTestContextFilePath(id), {
    force: true,
  });
}
