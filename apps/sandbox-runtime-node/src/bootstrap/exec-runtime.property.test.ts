/* eslint-disable jest/no-standalone-expect --
 * `@fast-check/vitest` property callbacks are test bodies, but the lint rule does not detect them.
 */

import { resolve } from "node:path";

import { fc, test as propertyTest } from "@fast-check/vitest";
import { expect } from "vitest";

import { buildRuntimeExecArgs } from "./runtime-exec-input.js";

const BootstrapEntrypointPath = resolve(process.cwd(), "dist/bootstrap/main.js");
const BootstrapEntrypointRelativePath = "dist/bootstrap/main.js";
const RuntimeEntrypointPath = resolve(process.cwd(), "dist/main.js");
const NodeExecutablePath = "/usr/local/bin/node";

const ArgTokenArbitrary = fc.stringMatching(/^[a-z0-9_-]{1,12}$/).map((token) => `arg-${token}`);

propertyTest.prop(
  [
    fc.array(ArgTokenArbitrary, { maxLength: 8 }),
    fc.constantFrom(BootstrapEntrypointPath, BootstrapEntrypointRelativePath),
    fc.array(ArgTokenArbitrary, { maxLength: 8 }),
  ],
  { numRuns: 100 },
)(
  "replaces exactly one bootstrap entrypoint while preserving argument order and length",
  (prefixArgs, bootstrapArg, suffixArgs) => {
    const processArgv = [NodeExecutablePath, ...prefixArgs, bootstrapArg, ...suffixArgs];

    expect(
      buildRuntimeExecArgs(processArgv, BootstrapEntrypointPath, RuntimeEntrypointPath),
    ).toEqual([...prefixArgs, RuntimeEntrypointPath, ...suffixArgs]);
  },
);

propertyTest.prop([fc.array(ArgTokenArbitrary, { maxLength: 12 })], { numRuns: 100 })(
  "throws when argv does not contain the bootstrap entrypoint",
  (runtimeArgs) => {
    expect(() =>
      buildRuntimeExecArgs(
        [NodeExecutablePath, ...runtimeArgs],
        BootstrapEntrypointPath,
        RuntimeEntrypointPath,
      ),
    ).toThrow(`failed to locate bootstrap entrypoint "${BootstrapEntrypointPath}" in argv`);
  },
);
