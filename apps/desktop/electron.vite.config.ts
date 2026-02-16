import { resolve } from "path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import pkg from "./package.json"

const builderConfig = require("./electron-builder.config.cjs")

const define = {
  "process.env.APP_ID": JSON.stringify(builderConfig.appId),
  "process.env.PRODUCT_NAME": JSON.stringify(builderConfig.productName),
  "process.env.APP_VERSION": JSON.stringify(pkg.version),
  "process.env.IS_MAC": JSON.stringify(process.platform === "darwin"),
}

// externalizeDepsPlugin only reads pkg.dependencies, not optionalDependencies.
// Native modules like onnxruntime-node must be externalized (not bundled) so their
// internal require() for .node bindings works at runtime.
const optionalDeps = Object.keys(pkg.optionalDependencies || {})

export default defineConfig({
  main: {
    plugins: [tsconfigPaths(), externalizeDepsPlugin({ include: optionalDeps })],
    define,
  },
  preload: {
    plugins: [tsconfigPaths(), externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    define,
    plugins: [tsconfigPaths(), react()],
  },
})
