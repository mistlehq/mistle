import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createControlPlaneOpenApiDocument } from "./document.js";

const OPENAPI_SPEC_FILE_URL = new URL("../../openapi/control-plane.v1.json", import.meta.url);

function serializeDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function getOpenApiSpecFilePath(): string {
  return fileURLToPath(OPENAPI_SPEC_FILE_URL);
}

export async function writeOpenApiSpecFile(): Promise<void> {
  const document = createControlPlaneOpenApiDocument();
  const serializedDocument = serializeDocument(document);

  await mkdir(new URL("./", OPENAPI_SPEC_FILE_URL), { recursive: true });
  await writeFile(OPENAPI_SPEC_FILE_URL, serializedDocument, "utf8");
}

export async function assertOpenApiSpecFileIsCurrent(): Promise<void> {
  const document = createControlPlaneOpenApiDocument();
  const expected = serializeDocument(document);

  let actual = "";
  try {
    actual = await readFile(OPENAPI_SPEC_FILE_URL, "utf8");
  } catch (error: unknown) {
    throw new Error(
      [
        `OpenAPI spec file is missing at ${getOpenApiSpecFilePath()}.`,
        "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
      ].join(" "),
      { cause: error },
    );
  }

  const normalizedActual = serializeDocument(JSON.parse(actual));
  if (normalizedActual !== expected) {
    throw new Error(
      [
        `OpenAPI drift detected at ${getOpenApiSpecFilePath()}.`,
        "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
      ].join(" "),
    );
  }
}
