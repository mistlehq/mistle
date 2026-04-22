import { Buffer } from "node:buffer";

import { defineConfig } from "vite";

const FaviconBody = "mistle-vite-fixture-favicon";
const VirtualModuleId = "virtual:mistle-vite-fixture";
const ResolvedVirtualModuleId = `\\0${VirtualModuleId}`;

export default defineConfig({
  server: {
    watch: {
      interval: 100,
      usePolling: true,
    },
  },
  plugins: [
    {
      name: "mistle-vite-fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/favicon.ico") {
            next();
            return;
          }

          response.statusCode = 200;
          response.setHeader("Content-Length", Buffer.byteLength(FaviconBody));
          response.setHeader("Content-Type", "");
          response.end(FaviconBody);
        });
      },
      load(id) {
        if (id !== ResolvedVirtualModuleId) {
          return undefined;
        }

        return [
          'export const virtualMessage = "virtual fixture loaded";',
          'export const virtualList = ["hmr", "css", "asset"];',
        ].join("\n");
      },
      resolveId(id) {
        if (id === VirtualModuleId) {
          return ResolvedVirtualModuleId;
        }

        return undefined;
      },
    },
  ],
});
