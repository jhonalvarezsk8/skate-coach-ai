import CopyPlugin from "copy-webpack-plugin";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      const mpDist = path.resolve(__dirname, "node_modules/@mediapipe/tasks-vision");
      const publicDir = path.resolve(__dirname, "public");

      config.plugins.push(
        new CopyPlugin({
          patterns: [
            // MediaPipe ESM bundle — loaded in Web Worker via webpackIgnore dynamic import
            {
              from: path.join(mpDist, "vision_bundle.mjs"),
              to: path.join(publicDir, "js", "mediapipe-vision.mjs"),
              info: { minimized: true },
            },
            // MediaPipe WASM runtime files
            {
              from: path.join(mpDist, "wasm", "vision_wasm_internal.js"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_internal.js"),
              info: { minimized: true },
            },
            {
              from: path.join(mpDist, "wasm", "vision_wasm_internal.wasm"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_internal.wasm"),
              info: { minimized: true },
            },
            {
              from: path.join(mpDist, "wasm", "vision_wasm_module_internal.js"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_module_internal.js"),
              info: { minimized: true },
            },
            {
              from: path.join(mpDist, "wasm", "vision_wasm_module_internal.wasm"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_module_internal.wasm"),
              info: { minimized: true },
            },
            {
              from: path.join(mpDist, "wasm", "vision_wasm_nosimd_internal.js"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_nosimd_internal.js"),
              info: { minimized: true },
            },
            {
              from: path.join(mpDist, "wasm", "vision_wasm_nosimd_internal.wasm"),
              to: path.join(publicDir, "wasm", "mediapipe", "vision_wasm_nosimd_internal.wasm"),
              info: { minimized: true },
            },
          ],
        })
      );

      // Exclude public/js from webpack module processing
      config.module.rules.push({
        test: /public[/\\]js[/\\]mediapipe-vision\.mjs$/,
        type: "asset/resource",
      });
    }

    return config;
  },

  // Cross-Origin headers required for SharedArrayBuffer (WASM multi-threading)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
