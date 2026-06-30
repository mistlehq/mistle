import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RepositoryRootPath = fileURLToPath(new URL("../../../..", import.meta.url));

export function resolveRepositoryPath(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }

  return resolve(RepositoryRootPath, path);
}
