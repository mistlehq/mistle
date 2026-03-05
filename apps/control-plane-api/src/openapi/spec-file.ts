import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createControlPlaneInternalOpenApiDocument,
  createControlPlaneOpenApiDocument,
} from "./document.js";

const OPENAPI_SPEC_FILE_URL = new URL("../../openapi/control-plane.v1.json", import.meta.url);
const INTERNAL_OPENAPI_SPEC_FILE_URL = new URL(
  "../../openapi/control-plane.internal.v1.json",
  import.meta.url,
);

function serializeDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function getOpenApiSpecFilePath(): string {
  return fileURLToPath(OPENAPI_SPEC_FILE_URL);
}

export function getInternalOpenApiSpecFilePath(): string {
  return fileURLToPath(INTERNAL_OPENAPI_SPEC_FILE_URL);
}

async function writeSpecFile(input: { fileUrl: URL; document: unknown }): Promise<void> {
  const serializedDocument = serializeDocument(input.document);

  await mkdir(new URL("./", input.fileUrl), { recursive: true });
  await writeFile(input.fileUrl, serializedDocument, "utf8");
}

export async function writeOpenApiSpecFile(): Promise<void> {
  await writeSpecFile({
    fileUrl: OPENAPI_SPEC_FILE_URL,
    document: createControlPlaneOpenApiDocument(),
  });
  await writeSpecFile({
    fileUrl: INTERNAL_OPENAPI_SPEC_FILE_URL,
    document: createControlPlaneInternalOpenApiDocument(),
  });
}

async function assertSpecFileIsCurrent(input: {
  fileUrl: URL;
  document: unknown;
  missingErrorMessage: string;
  driftErrorMessage: string;
}): Promise<void> {
  const expected = serializeDocument(input.document);

  let actual = "";
  try {
    actual = await readFile(input.fileUrl, "utf8");
  } catch (error: unknown) {
    throw new Error(input.missingErrorMessage, { cause: error });
  }

  const normalizedActual = serializeDocument(JSON.parse(actual));
  if (normalizedActual !== expected) {
    throw new Error(input.driftErrorMessage);
  }
}

export async function assertOpenApiSpecFileIsCurrent(): Promise<void> {
  await assertSpecFileIsCurrent({
    fileUrl: OPENAPI_SPEC_FILE_URL,
    document: createControlPlaneOpenApiDocument(),
    missingErrorMessage: [
      `OpenAPI spec file is missing at ${getOpenApiSpecFilePath()}.`,
      "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
    ].join(" "),
    driftErrorMessage: [
      `OpenAPI drift detected at ${getOpenApiSpecFilePath()}.`,
      "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
    ].join(" "),
  });
  await assertSpecFileIsCurrent({
    fileUrl: INTERNAL_OPENAPI_SPEC_FILE_URL,
    document: createControlPlaneInternalOpenApiDocument(),
    missingErrorMessage: [
      `Internal OpenAPI spec file is missing at ${getInternalOpenApiSpecFilePath()}.`,
      "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
    ].join(" "),
    driftErrorMessage: [
      `Internal OpenAPI drift detected at ${getInternalOpenApiSpecFilePath()}.`,
      "Run: pnpm --filter @mistle/control-plane-api openapi:generate",
    ].join(" "),
  });
}
