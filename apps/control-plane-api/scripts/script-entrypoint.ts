import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isDirectEntrypoint(input: {
  argvPath: string | undefined;
  moduleUrl: string;
}): boolean {
  if (input.argvPath === undefined) {
    return false;
  }

  return realpathSync(fileURLToPath(input.moduleUrl)) === realpathSync(input.argvPath);
}
