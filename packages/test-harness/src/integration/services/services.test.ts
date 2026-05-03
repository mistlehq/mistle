import { describe, expect, it } from "vitest";

import { ServiceIds } from "./service-ids.js";
import { ServiceMetadataById } from "./service-metadata.js";

describe("integration services", () => {
  it("declares concrete launch modes for every service", () => {
    expect(ServiceMetadataById[ServiceIds.CONTROL_PLANE_API].supportedModes).toEqual(["runtime"]);
    expect(ServiceMetadataById[ServiceIds.CONTROL_PLANE_WORKER].supportedModes).toEqual([
      "runtime",
      "process",
    ]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_API].supportedModes).toEqual(["runtime"]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_GATEWAY].supportedModes).toEqual(["runtime"]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_WORKER].supportedModes).toEqual([
      "runtime",
      "process",
    ]);
    expect(ServiceMetadataById[ServiceIds.TOKENIZER_PROXY].supportedModes).toEqual(["runtime"]);
  });

  it("declares peer references owned by each service definition", () => {
    expect(ServiceMetadataById[ServiceIds.CONTROL_PLANE_API].serviceReferences).toEqual([]);
    expect(ServiceMetadataById[ServiceIds.CONTROL_PLANE_WORKER].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
      ServiceIds.DATA_PLANE_API,
    ]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_API].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
    ]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_GATEWAY].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
      ServiceIds.DATA_PLANE_API,
    ]);
    expect(ServiceMetadataById[ServiceIds.DATA_PLANE_WORKER].serviceReferences).toEqual([
      ServiceIds.DATA_PLANE_GATEWAY,
      ServiceIds.TOKENIZER_PROXY,
      ServiceIds.CONTROL_PLANE_API,
    ]);
    expect(ServiceMetadataById[ServiceIds.TOKENIZER_PROXY].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
    ]);
  });
});
