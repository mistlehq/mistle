import { setCurrentProcessNonDumpable } from "@mistle/sandbox-rs-napi";

export function applyCurrentProcessSecurity(): void {
  if (process.platform !== "linux") {
    return;
  }

  setCurrentProcessNonDumpable();
}
