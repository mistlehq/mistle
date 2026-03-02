import type { ConfigModule } from "../../core/module.js";
import { loadTokenizerProxyFromEnv } from "./load-env.js";
import { loadTokenizerProxyFromToml } from "./load-toml.js";
import { TokenizerProxyConfigSchema } from "./schema.js";

export { loadTokenizerProxyFromEnv } from "./load-env.js";
export { loadTokenizerProxyFromToml } from "./load-toml.js";
export { TokenizerProxyConfigSchema } from "./schema.js";

export const tokenizerProxyConfigModule: ConfigModule<typeof TokenizerProxyConfigSchema> = {
  namespace: ["apps", "tokenizer_proxy"],
  schema: TokenizerProxyConfigSchema,
  loadToml: loadTokenizerProxyFromToml,
  loadEnv: loadTokenizerProxyFromEnv,
};
