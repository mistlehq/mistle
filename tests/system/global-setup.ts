import { DefaultSandboxBaseImageBuild } from "@mistle/test-harness";

import { createSystemGlobalSetup } from "./create-global-setup.js";

export default createSystemGlobalSetup({
  sandboxBaseImageBuild: DefaultSandboxBaseImageBuild,
});
