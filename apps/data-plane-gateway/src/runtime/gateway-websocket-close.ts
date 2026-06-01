export type GatewayWebSocketCloseReason = "service_restart";

type GatewayWebSocketCloseCodesShape = Readonly<{
  SERVICE_RESTART: 4001;
}>;

export const GatewayWebSocketCloseCodes: GatewayWebSocketCloseCodesShape = Object.freeze({
  SERVICE_RESTART: 4001,
});

export const GatewayWebSocketCloseReasons: Readonly<{
  SERVICE_RESTART: GatewayWebSocketCloseReason;
}> = Object.freeze({
  SERVICE_RESTART: "service_restart",
});
