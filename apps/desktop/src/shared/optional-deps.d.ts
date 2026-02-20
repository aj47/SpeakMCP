/**
 * Optional dependency shims.
 *
 * These packages are loaded dynamically at runtime and may not be installed in
 * all dev/CI environments. We declare them as `any` so `tsc` typechecks pass.
 */

declare module "onnxruntime-node"
