import type { ConfigModule } from "../../core/module.js";
import { loadTokenizerProxyFromEnv } from "./load-env.js";
import { TokenizerProxyConfigSchema } from "./schema.js";

export { loadTokenizerProxyFromEnv } from "./load-env.js";
export { TokenizerProxyConfigSchema } from "./schema.js";

export const tokenizerProxyConfigModule: ConfigModule<typeof TokenizerProxyConfigSchema> = {
  namespace: ["apps", "tokenizer_proxy"],
  schema: TokenizerProxyConfigSchema,
  loadEnv: loadTokenizerProxyFromEnv,
};
