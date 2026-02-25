import { AppIds, loadConfig } from "@mistle/config";

import { createApp } from "./app.js";
import { startServer } from "./server.js";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_API,
  env: process.env,
  includeGlobal: false,
});
const appConfig = loadedConfig.app;
const app = createApp(appConfig);

startServer({
  app,
  host: appConfig.server.host,
  port: appConfig.server.port,
});

console.log(
  "@mistle/control-plane-api listening on " +
    appConfig.server.host +
    ":" +
    String(appConfig.server.port) +
    " with auth at " +
    appConfig.auth.baseUrl,
);
