export const DataPlaneGatewayIntegrationTestContextId =
  process.env.MISTLE_DATA_PLANE_GATEWAY_TEST_CONTEXT_ID ?? "data-plane-gateway.integration";

export const DataPlaneGatewayTemplateDatabaseNamePrefix =
  process.env.MISTLE_DATA_PLANE_GATEWAY_TEMPLATE_DB_PREFIX ??
  "mistle_data_plane_gateway_it_template";

export const DataPlaneGatewayRuntimeDatabaseNamePrefix =
  process.env.MISTLE_DATA_PLANE_GATEWAY_RUNTIME_DB_PREFIX ?? "mistle_data_plane_gateway_it_runtime";
