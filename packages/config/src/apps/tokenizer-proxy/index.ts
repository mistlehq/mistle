import { loadTokenizerProxyFromEnv } from "./load-env.js";
import { TokenizerProxyConfigSchema } from "./schema.js";

export { loadTokenizerProxyFromEnv } from "./load-env.js";
export { TokenizerProxyConfigSchema } from "./schema.js";

export const tokenizerProxyConfigModule = {
  schema: TokenizerProxyConfigSchema,
  loadEnv: loadTokenizerProxyFromEnv,
};
