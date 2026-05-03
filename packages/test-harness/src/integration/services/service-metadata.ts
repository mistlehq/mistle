import { ServiceIds } from "./service-ids.js";

export const ServiceMetadataById = {
  [ServiceIds.CONTROL_PLANE_API]: {
    serviceReferences: [],
    supportedModes: ["runtime"],
  },
  [ServiceIds.CONTROL_PLANE_WORKER]: {
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    supportedModes: ["runtime", "process"],
  },
  [ServiceIds.DATA_PLANE_API]: {
    serviceReferences: [ServiceIds.CONTROL_PLANE_API],
    supportedModes: ["runtime"],
  },
  [ServiceIds.DATA_PLANE_GATEWAY]: {
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    supportedModes: ["runtime"],
  },
  [ServiceIds.DATA_PLANE_WORKER]: {
    serviceReferences: [
      ServiceIds.DATA_PLANE_GATEWAY,
      ServiceIds.TOKENIZER_PROXY,
      ServiceIds.CONTROL_PLANE_API,
    ],
    supportedModes: ["runtime", "process"],
  },
  [ServiceIds.TOKENIZER_PROXY]: {
    serviceReferences: [ServiceIds.CONTROL_PLANE_API],
    supportedModes: ["runtime"],
  },
} as const;
