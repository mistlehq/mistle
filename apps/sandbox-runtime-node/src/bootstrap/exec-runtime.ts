import { execRuntimeAsUser, type ExecRuntimeAsUserInput } from "@mistle/sandbox-rs-napi";

export function execRuntime(input: ExecRuntimeAsUserInput): never {
  // The native layer owns the privilege transition and exec handoff sequence:
  // setgroups -> setgid -> setuid -> clear stdio FD_CLOEXEC -> execve(runtime).
  // Bootstrap stays at the policy/orchestration layer and does not duplicate that
  // syscall ordering in JS.
  execRuntimeAsUser(input);
  throw new Error("sandbox runtime exec returned unexpectedly");
}
