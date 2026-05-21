import { resolveSystemTestSandboxBaseImageRef } from "../../packages/test-harness/src/system/system-test-sandbox-base-image.js";

const imageRef = await resolveSystemTestSandboxBaseImageRef();
process.stdout.write(`${imageRef}\n`);
