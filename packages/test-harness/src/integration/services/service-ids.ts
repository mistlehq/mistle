export const ServiceIds = {
  CONTROL_PLANE_API: "control-plane-api",
  CONTROL_PLANE_WORKER: "control-plane-worker",
  DATA_PLANE_API: "data-plane-api",
  DATA_PLANE_GATEWAY: "data-plane-gateway",
  DATA_PLANE_WORKER: "data-plane-worker",
  TOKENIZER_PROXY: "tokenizer-proxy",
} as const;

export type ServiceId = (typeof ServiceIds)[keyof typeof ServiceIds];
