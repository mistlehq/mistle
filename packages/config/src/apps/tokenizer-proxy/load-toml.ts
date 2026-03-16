import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
} from "./schema.js";

export function loadTokenizerProxyFromToml(
  tomlRoot: Record<string, unknown>,
): PartialTokenizerProxyConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const tokenizerProxy = coerceConfigObjectNode(apps.tokenizer_proxy);
  const server = coerceConfigObjectNode(tokenizerProxy.server);
  const controlPlaneApi = coerceConfigObjectNode(tokenizerProxy.control_plane_api);

  return PartialTokenizerProxyConfigSchema.parse({
    server: {
      host: server.host,
      port: server.port,
    },
    controlPlaneApi: {
      baseUrl: controlPlaneApi.base_url,
    },
  });
}
