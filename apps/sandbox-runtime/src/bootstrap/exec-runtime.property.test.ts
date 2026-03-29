/* eslint-disable jest/no-standalone-expect --
 * `@fast-check/vitest` property callbacks are test bodies, but the lint rule does not detect them.
 */

import { fc, test as propertyTest } from "@fast-check/vitest";
import { expect } from "vitest";

import { buildNodeScriptRuntimeArgs } from "./runtime-exec-input.js";

const NodeExecutablePath = "/usr/local/bin/node";
const BootstrapRuntimeCommandName = "bootstrap-runtime";
const RuntimeInternalCommandName = "runtime-internal";

const ArgTokenArbitrary = fc.stringMatching(/^[a-z0-9_-]{1,12}$/).map((token) => `arg-${token}`);

propertyTest.prop(
  [fc.array(ArgTokenArbitrary, { maxLength: 8 }), fc.array(ArgTokenArbitrary, { maxLength: 8 })],
  { numRuns: 100 },
)(
  "replaces exactly one bootstrap-runtime command while preserving argument order and length",
  (prefixArgs, suffixArgs) => {
    const processArgv = [
      NodeExecutablePath,
      ...prefixArgs,
      BootstrapRuntimeCommandName,
      ...suffixArgs,
    ];

    expect(buildNodeScriptRuntimeArgs(processArgv)).toEqual([
      ...prefixArgs,
      RuntimeInternalCommandName,
      ...suffixArgs,
    ]);
  },
);

propertyTest.prop([fc.array(ArgTokenArbitrary, { maxLength: 12 })], { numRuns: 100 })(
  "throws when argv does not contain the bootstrap-runtime command",
  (runtimeArgs) => {
    expect(() => buildNodeScriptRuntimeArgs([NodeExecutablePath, ...runtimeArgs])).toThrow(
      `failed to locate bootstrap runtime command "${BootstrapRuntimeCommandName}" in argv`,
    );
  },
);
