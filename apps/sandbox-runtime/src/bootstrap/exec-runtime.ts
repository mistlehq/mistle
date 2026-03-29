import { execRuntime as execNativeRuntime, type ExecRuntimeInput } from "@mistle/sandbox-rs-napi";

export function execRuntime(input: ExecRuntimeInput): never {
  // The native layer owns the target-identity switch and exec handoff sequence:
  // setgroups -> setgid -> setuid -> clear stdio FD_CLOEXEC -> execve(runtime).
  // Bootstrap stays at the policy/orchestration layer and does not duplicate that
  // syscall ordering in JS.
  execNativeRuntime(input);
  throw new Error("sandbox runtime exec returned unexpectedly");
}
