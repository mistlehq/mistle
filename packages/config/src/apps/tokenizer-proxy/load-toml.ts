import { asObjectRecord } from "../../core/record.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
} from "./schema.js";

export function loadTokenizerProxyFromToml(
  tomlRoot: Record<string, unknown>,
): PartialTokenizerProxyConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const tokenizerProxy = asObjectRecord(apps.tokenizer_proxy);
  const server = asObjectRecord(tokenizerProxy.server);
  const controlPlaneApi = asObjectRecord(tokenizerProxy.control_plane_api);

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
