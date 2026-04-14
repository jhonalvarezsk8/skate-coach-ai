// Manages a singleton ONNX InferenceSession inside the Web Worker.
// Selects the best available execution provider: WebGPU → WASM.
//
// IMPORTANT: onnxruntime-web is loaded via a direct URL import (webpackIgnore)
// from /public/js/ort.bundle.min.mjs instead of the npm package.
// This avoids webpack bundling the ESM module and triggering import.meta errors.

export interface SessionInfo {
  provider: "webgpu" | "wasm";
}

let _sessionPromise: Promise<{
  session: import("onnxruntime-web").InferenceSession;
  ort: typeof import("onnxruntime-web");
  info: SessionInfo;
}> | null = null;

export async function getOrCreateSession(): Promise<{
  session: import("onnxruntime-web").InferenceSession;
  ort: typeof import("onnxruntime-web");
  info: SessionInfo;
}> {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = createSession();
  return _sessionPromise;
}

async function createSession(): Promise<{
  session: import("onnxruntime-web").InferenceSession;
  ort: typeof import("onnxruntime-web");
  info: SessionInfo;
}> {
  // Load ort from public/js/ — webpackIgnore prevents webpack from bundling
  // this import, so it becomes a runtime dynamic import of an absolute URL.
  // The URL is resolved relative to the Worker's own location.
  const ortUrl = new URL("/js/ort.bundle.min.mjs", self.location.href).href;
  const ort = (await import(/* webpackIgnore: true */ ortUrl)) as typeof import("onnxruntime-web");

  // Point WASM runtime to static files in /public/wasm/
  ort.env.wasm.wasmPaths = "/wasm/";
  ort.env.wasm.numThreads = Math.min(
    (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2) ?? 2,
    4
  );

  const provider = await detectBestProvider();

  const session = await ort.InferenceSession.create("/models/yolov8n-pose.onnx", {
    executionProviders: provider === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
    graphOptimizationLevel: "all",
  });

  // Warmup: JIT-compile shaders / initialise WASM
  const dummyData = new Float32Array(1 * 3 * 640 * 640).fill(0.5);
  const dummyTensor = new ort.Tensor("float32", dummyData, [1, 3, 640, 640]);
  await session.run({ images: dummyTensor });

  return { session, ort, info: { provider } };
}

async function detectBestProvider(): Promise<"webgpu" | "wasm"> {
  try {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      const adapter = await (
        navigator as unknown as {
          gpu: { requestAdapter: () => Promise<unknown> };
        }
      ).gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {
    // WebGPU not available
  }
  return "wasm";
}
