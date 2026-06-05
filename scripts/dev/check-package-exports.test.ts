import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validatePackageExports } from "./check-package-exports.js";

type WorkspaceFixture = {
  readonly root: string;
  readonly write: (path: string, content: string) => void;
};

function withWorkspace(run: (fixture: WorkspaceFixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), "mistle-package-exports-"));

  try {
    for (const directory of ["apps", "packages", "tests"]) {
      mkdirSync(join(root, directory), { recursive: true });
    }

    run({
      root,
      write(path, content) {
        const filePath = join(root, path);
        mkdirSync(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
        writeFileSync(filePath, content, "utf8");
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validateFixture(fixture: WorkspaceFixture): string[] {
  return validatePackageExports({ workspaceRoot: fixture.root });
}

function writeBuildablePackage(
  fixture: WorkspaceFixture,
  packagePath: string,
  packageName: string,
): void {
  fixture.write(`${packagePath}/src/index.ts`, "export const value = 1;\n");
  fixture.write(`${packagePath}/dist/index.js`, "export const value = 1;\n");
  fixture.write(
    `${packagePath}/package.json`,
    JSON.stringify(
      {
        name: packageName,
        exports: {
          ".": {
            types: "./src/index.ts",
            "workspace-src": "./src/index.ts",
            node: "./dist/index.js",
            import: "./dist/index.js",
            default: "./dist/index.js",
          },
        },
      },
      null,
      2,
    ),
  );
}

describe("validatePackageExports", () => {
  it("accepts explicit source and runtime conditions for a buildable package", () => {
    withWorkspace((fixture) => {
      writeBuildablePackage(fixture, "packages/valid", "@mistle/valid");
      fixture.write("apps/app/src/index.ts", 'import { value } from "@mistle/valid";\n');

      expect(validateFixture(fixture)).toEqual([]);
    });
  });

  it("rejects condition objects where runtime conditions precede workspace-src", () => {
    withWorkspace((fixture) => {
      fixture.write("packages/bad-order/src/index.ts", "export const value = 1;\n");
      fixture.write("packages/bad-order/dist/index.js", "export const value = 1;\n");
      fixture.write(
        "packages/bad-order/package.json",
        JSON.stringify(
          {
            name: "@mistle/bad-order",
            exports: {
              ".": {
                types: "./src/index.ts",
                import: "./dist/index.js",
                "workspace-src": "./src/index.ts",
                default: "./dist/index.js",
              },
            },
          },
          null,
          2,
        ),
      );

      expect(validateFixture(fixture)).toContain(
        `${fixture.root}/packages/bad-order/package.json: export . conditions must be ordered as types, workspace-src, node, import, default`,
      );
    });
  });

  it("rejects string exports for TypeScript package entrypoints", () => {
    withWorkspace((fixture) => {
      fixture.write("packages/string-export/src/index.ts", "export const value = 1;\n");
      fixture.write(
        "packages/string-export/package.json",
        JSON.stringify(
          {
            name: "@mistle/string-export",
            exports: {
              ".": "./src/index.ts",
            },
          },
          null,
          2,
        ),
      );

      expect(validateFixture(fixture)).toContain(
        `${fixture.root}/packages/string-export/package.json: export . must use a condition object unless it is an explicit asset export`,
      );
    });
  });

  it("rejects runtime targets without a JavaScript extension", () => {
    withWorkspace((fixture) => {
      fixture.write("packages/non-js-runtime/src/index.ts", "export const value = 1;\n");
      fixture.write("packages/non-js-runtime/dist/index", "export const value = 1;\n");
      fixture.write(
        "packages/non-js-runtime/package.json",
        JSON.stringify(
          {
            name: "@mistle/non-js-runtime",
            exports: {
              ".": {
                types: "./src/index.ts",
                "workspace-src": "./src/index.ts",
                node: "./dist/index",
                import: "./dist/index",
                default: "./dist/index",
              },
            },
          },
          null,
          2,
        ),
      );

      expect(validateFixture(fixture)).toContain(
        `${fixture.root}/packages/non-js-runtime/package.json: export . node target ./dist/index must end in .js`,
      );
    });
  });

  it("catches side-effect imports of unexported package subpaths", () => {
    withWorkspace((fixture) => {
      writeBuildablePackage(fixture, "packages/library", "@mistle/library");
      fixture.write("apps/app/src/index.ts", 'import "@mistle/library/internal";\n');

      expect(validateFixture(fixture)).toContain(
        `${fixture.root}/apps/app/src/index.ts: @mistle/library/internal is not an explicit export`,
      );
    });
  });

  it("catches re-exports from unexported package subpaths", () => {
    withWorkspace((fixture) => {
      writeBuildablePackage(fixture, "packages/library", "@mistle/library");
      fixture.write("apps/app/src/index.ts", 'export { value } from "@mistle/library/internal";\n');

      expect(validateFixture(fixture)).toContain(
        `${fixture.root}/apps/app/src/index.ts: @mistle/library/internal is not an explicit export`,
      );
    });
  });
});
