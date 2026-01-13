import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  shims: true,
  // Bundle all dependencies to make the server self-contained
  // This allows the server to run without needing external node_modules
  noExternal: [/.*/],
})

