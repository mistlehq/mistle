import { installResponsiveBreakpointTestVariables } from "@mistle/ui/test-support/responsive-breakpoints.js";
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
  VITE_MISTLE_RELEASE_VERSION: "0.18.1",
});

if (typeof document !== "undefined" && typeof window !== "undefined") {
  installResponsiveBreakpointTestVariables(document);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: createMatchMedia,
    writable: true,
  });
}

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: createCanvasContext,
    writable: true,
  });
}

function createMatchMedia(query: string): MediaQueryList {
  return {
    matches: matchesMediaQuery(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  };
}

function matchesMediaQuery(query: string): boolean {
  const maxWidthMatch = /^\(max-width: ([0-9.]+)px\)$/.exec(query);
  if (maxWidthMatch !== null) {
    return window.innerWidth <= Number(maxWidthMatch[1]);
  }

  const minWidthMatch = /^\(min-width: ([0-9.]+)px\)$/.exec(query);
  if (minWidthMatch !== null) {
    return window.innerWidth >= Number(minWidthMatch[1]);
  }

  return false;
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
