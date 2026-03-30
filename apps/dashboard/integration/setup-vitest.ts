function createMatchMedia(query: string): MediaQueryList {
  return {
    addEventListener() {},
    addListener() {},
    dispatchEvent() {
      return false;
    },
    matches: false,
    media: query,
    onchange: null,
    removeEventListener() {},
    removeListener() {},
  };
}

function createCanvasContext(): CanvasRenderingContext2D {
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
  } as CanvasRenderingContext2D;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: createMatchMedia,
  writable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: createCanvasContext,
  writable: true,
});

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class ResizeObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  },
  writable: true,
});
