import { describe, expect, it } from "vitest";

import {
  consumeDeviceReauthorizationStartRequest,
  resolveDeviceReauthorizationStartRequest,
  type DeviceReauthorizationStartRequest,
} from "./use-integration-connection-editor-state.js";

const StartedDeviceAuthorizationConnection = {
  attemptId: "ida_reauth",
  status: "pending",
  verificationUrl: "https://auth.openai.com/device",
  userCode: "ABCD-1234",
} as const;

describe("device reauthorization start request lifecycle", () => {
  it("adopts an in-flight start request for the same connection", () => {
    const request = Promise.resolve(StartedDeviceAuthorizationConnection);
    const currentRequest: DeviceReauthorizationStartRequest = {
      connectionId: "icn_chatgpt",
      consumed: false,
      request,
    };

    const resolvedRequest = resolveDeviceReauthorizationStartRequest({
      connectionId: "icn_chatgpt",
      currentRequest,
      startRequest: () => Promise.resolve(StartedDeviceAuthorizationConnection),
    });

    expect(resolvedRequest).toBe(currentRequest);
  });

  it("does not adopt a consumed start request for the same connection", () => {
    const request = Promise.resolve(StartedDeviceAuthorizationConnection);

    const resolvedRequest = resolveDeviceReauthorizationStartRequest({
      connectionId: "icn_chatgpt",
      currentRequest: {
        connectionId: "icn_chatgpt",
        consumed: true,
        request,
      },
      startRequest: () => Promise.resolve(StartedDeviceAuthorizationConnection),
    });

    expect(resolvedRequest).toBeNull();
  });

  it("marks only the active start request as consumed", () => {
    const request = Promise.resolve(StartedDeviceAuthorizationConnection);
    const currentRequest: DeviceReauthorizationStartRequest = {
      connectionId: "icn_chatgpt",
      consumed: false,
      request,
    };

    const consumedRequest = consumeDeviceReauthorizationStartRequest({
      connectionId: "icn_chatgpt",
      currentRequest,
      request,
    });

    expect(consumedRequest).toEqual({
      connectionId: "icn_chatgpt",
      consumed: true,
      request,
    });
  });

  it("leaves obsolete start requests unchanged", () => {
    const request = Promise.resolve(StartedDeviceAuthorizationConnection);
    const obsoleteRequest = Promise.resolve(StartedDeviceAuthorizationConnection);
    const currentRequest: DeviceReauthorizationStartRequest = {
      connectionId: "icn_chatgpt",
      consumed: false,
      request,
    };

    const consumedRequest = consumeDeviceReauthorizationStartRequest({
      connectionId: "icn_chatgpt",
      currentRequest,
      request: obsoleteRequest,
    });

    expect(consumedRequest).toBe(currentRequest);
  });
});
