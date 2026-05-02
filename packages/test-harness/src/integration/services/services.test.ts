import { describe, expect, it } from "vitest";

import { createTestRegistry } from "../../environment/service-catalog.js";
import { service as controlPlaneApi } from "./control-plane-api.js";
import { service as controlPlaneWorker } from "./control-plane-worker.js";
import { service as dataPlaneApi } from "./data-plane-api.js";
import { service as dataPlaneGateway } from "./data-plane-gateway.js";
import { service as dataPlaneWorker } from "./data-plane-worker.js";
import { ServiceIds } from "./service-ids.js";
import { service as tokenizerProxy } from "./tokenizer-proxy.js";

describe("integration services", () => {
  it("declares concrete launch modes for every service", () => {
    const catalog = createTestRegistry();
    const services = {
      [ServiceIds.CONTROL_PLANE_API]: controlPlaneApi(catalog[ServiceIds.CONTROL_PLANE_API].infra),
      [ServiceIds.CONTROL_PLANE_WORKER]: controlPlaneWorker(
        catalog[ServiceIds.CONTROL_PLANE_WORKER].infra,
      ),
      [ServiceIds.DATA_PLANE_API]: dataPlaneApi(catalog[ServiceIds.DATA_PLANE_API].infra),
      [ServiceIds.DATA_PLANE_GATEWAY]: dataPlaneGateway(
        catalog[ServiceIds.DATA_PLANE_GATEWAY].infra,
      ),
      [ServiceIds.DATA_PLANE_WORKER]: dataPlaneWorker(catalog[ServiceIds.DATA_PLANE_WORKER].infra),
      [ServiceIds.TOKENIZER_PROXY]: tokenizerProxy(catalog[ServiceIds.TOKENIZER_PROXY].infra),
    };

    expect(services[ServiceIds.CONTROL_PLANE_API].supportedModes).toEqual(["runtime"]);
    expect(services[ServiceIds.CONTROL_PLANE_WORKER].supportedModes).toEqual([
      "runtime",
      "process",
    ]);
    expect(services[ServiceIds.DATA_PLANE_API].supportedModes).toEqual(["runtime"]);
    expect(services[ServiceIds.DATA_PLANE_GATEWAY].supportedModes).toEqual(["runtime"]);
    expect(services[ServiceIds.DATA_PLANE_WORKER].supportedModes).toEqual(["runtime", "process"]);
    expect(services[ServiceIds.TOKENIZER_PROXY].supportedModes).toEqual(["runtime"]);
  });

  it("declares peer references owned by each service definition", () => {
    const catalog = createTestRegistry();
    const services = {
      [ServiceIds.CONTROL_PLANE_API]: controlPlaneApi(catalog[ServiceIds.CONTROL_PLANE_API].infra),
      [ServiceIds.CONTROL_PLANE_WORKER]: controlPlaneWorker(
        catalog[ServiceIds.CONTROL_PLANE_WORKER].infra,
      ),
      [ServiceIds.DATA_PLANE_API]: dataPlaneApi(catalog[ServiceIds.DATA_PLANE_API].infra),
      [ServiceIds.DATA_PLANE_GATEWAY]: dataPlaneGateway(
        catalog[ServiceIds.DATA_PLANE_GATEWAY].infra,
      ),
      [ServiceIds.DATA_PLANE_WORKER]: dataPlaneWorker(catalog[ServiceIds.DATA_PLANE_WORKER].infra),
      [ServiceIds.TOKENIZER_PROXY]: tokenizerProxy(catalog[ServiceIds.TOKENIZER_PROXY].infra),
    };

    expect(services[ServiceIds.CONTROL_PLANE_API].serviceReferences).toEqual([]);
    expect(services[ServiceIds.CONTROL_PLANE_WORKER].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
      ServiceIds.DATA_PLANE_API,
    ]);
    expect(services[ServiceIds.DATA_PLANE_API].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
    ]);
    expect(services[ServiceIds.DATA_PLANE_GATEWAY].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
      ServiceIds.DATA_PLANE_API,
    ]);
    expect(services[ServiceIds.DATA_PLANE_WORKER].serviceReferences).toEqual([
      ServiceIds.DATA_PLANE_GATEWAY,
      ServiceIds.TOKENIZER_PROXY,
      ServiceIds.CONTROL_PLANE_API,
    ]);
    expect(services[ServiceIds.TOKENIZER_PROXY].serviceReferences).toEqual([
      ServiceIds.CONTROL_PLANE_API,
    ]);
  });
});
