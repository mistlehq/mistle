import { execRuntimeAsUser, type ExecRuntimeAsUserInput } from "@mistle/sandbox-rs-napi";

export function execRuntime(input: ExecRuntimeAsUserInput): never {
  execRuntimeAsUser(input);
  throw new Error("sandbox runtime exec returned unexpectedly");
}
