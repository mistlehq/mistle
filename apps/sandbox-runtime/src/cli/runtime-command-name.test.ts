import { describe, expect, it } from "vitest";

import { resolveRuntimeCommandName } from "./runtime-command-name.js";

describe("resolveRuntimeCommandName", () => {
  it("defaults to serve for node entrypoint invocation without a subcommand", () => {
    expect(resolveRuntimeCommandName(["node", "/app/main.js"])).toBe("serve");
  });

  it("defaults to serve for packaged runtime invocation without a subcommand", () => {
    expect(resolveRuntimeCommandName(["/usr/local/bin/sandboxd"])).toBe("serve");
  });

  it("resolves explicit runtime subcommands", () => {
    expect(resolveRuntimeCommandName(["node", "/app/main.js", "serve"])).toBe("serve");
    expect(resolveRuntimeCommandName(["node", "/app/main.js", "apply-startup"])).toBe(
      "apply-startup",
    );
    expect(resolveRuntimeCommandName(["node", "/app/main.js", "runtime-internal"])).toBe(
      "runtime-internal",
    );
  });

  it("resolves packaged runtime subcommands", () => {
    expect(resolveRuntimeCommandName(["/usr/local/bin/sandboxd", "serve"])).toBe("serve");
    expect(resolveRuntimeCommandName(["/usr/local/bin/sandboxd", "apply-startup"])).toBe(
      "apply-startup",
    );
  });

  it("uses the last recognized subcommand when extra wrapper argv values are present", () => {
    expect(resolveRuntimeCommandName(["/usr/local/bin/sandboxd", "apply-startup", "serve"])).toBe(
      "serve",
    );
    expect(
      resolveRuntimeCommandName([
        "/usr/local/bin/sandboxd",
        "/snapshot/mistle/apps/sandbox-runtime/dist/main.js",
        "apply-startup",
      ]),
    ).toBe("apply-startup");
  });

  it("throws on unsupported runtime commands", () => {
    expect(() => resolveRuntimeCommandName(["/usr/local/bin/sandboxd", "bogus"])).toThrow(
      'unsupported sandbox runtime command "bogus"',
    );
  });
});
