import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { resetDashboardConfigForTest } from "../config.js";
import { resetAuthClientForTest } from "../lib/auth/client.js";
import { cleanupTestQueryClients, flushScheduledReactWork } from "../test-support/query-client.js";

function createCanvasContext() {
  return {
    canvas: document.createElement("canvas"),
    beginPath() {},
    clearRect() {},
    clip() {},
    closePath() {},
    createImageData() {
      return {
        colorSpace: "srgb",
        data: new Uint8ClampedArray(4),
        height: 1,
        width: 1,
      };
    },
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    drawImage() {},
    fill() {},
    fillRect() {},
    fillText() {},
    getImageData() {
      return {
        colorSpace: "srgb",
        data: new Uint8ClampedArray(4),
        height: 1,
        width: 1,
      };
    },
    lineTo() {},
    measureText() {
      return {
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 0,
        fontBoundingBoxAscent: 0,
        fontBoundingBoxDescent: 0,
        width: 0,
      };
    },
    moveTo() {},
    putImageData() {},
    rect() {},
    restore() {},
    save() {},
    scale() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
    strokeRect() {},
    translate() {},
  };
}

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
});

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: createCanvasContext,
    writable: true,
  });
}

resetDashboardConfigForTest();
resetAuthClientForTest();

afterEach(async () => {
  cleanup();
  const cleanedQueryClients = await cleanupTestQueryClients();
  if (cleanedQueryClients) {
    await flushScheduledReactWork();
  }
});
