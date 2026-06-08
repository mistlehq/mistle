import { z } from "zod";

import { createRemoteMcpServerSelectionSchema } from "../../../shared/remote-mcp-server-catalog/index.js";
import { CloudflareMcpServerCatalog, CloudflareMcpServerIds } from "./mcp-catalog.js";

export const CloudflareBindingConfigSchema = z
  .object({
    mcpServers: createRemoteMcpServerSelectionSchema({
      catalog: CloudflareMcpServerCatalog,
      defaultSelectedIds: [CloudflareMcpServerIds.CLOUDFLARE_API],
    }),
  })
  .strict();

export type CloudflareBindingConfig = z.output<typeof CloudflareBindingConfigSchema>;
