const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

// Find the project and workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-yarn-workspace-root`
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Enable symlinks for pnpm
config.resolver.unstable_enableSymlinks = true;

// 4. Enable package exports for pnpm
config.resolver.unstable_enablePackageExports = true;

// 4b. Set condition names for proper CJS/ESM resolution through exports fields.
config.resolver.unstable_conditionNames = ['require', 'react-native'];

// 5. Packages whose "exports" field breaks Metro's CJS interop.
// call-bind@1.0.8 added an exports field that causes Metro to wrap the CJS
// module.exports function as an Object, leading to
// "callBind is not a function (it is Object)" at runtime.
const FORCE_NO_EXPORTS = new Set([
  'call-bind',
  'call-bind-apply-helpers',
  'get-intrinsic',
  'es-define-property',
  'set-function-length',
  'assert',
]);

// 6. Packages that must be deduplicated to avoid multiple instances.
// React/ReactDOM must be single instances or hooks will fail with
// "Cannot read properties of undefined (reading 'ReactCurrentDispatcher')"
const DEDUPE_PACKAGES = new Set([
  'react',
  'react-dom',
  'react-native',
  'react-native-web',
]);

// Pre-resolve dedupe packages to ensure single instances
const dedupeResolvedPaths = {};
for (const pkg of DEDUPE_PACKAGES) {
  const pkgPath = path.resolve(projectRoot, 'node_modules', pkg);
  if (fs.existsSync(pkgPath)) {
    dedupeResolvedPaths[pkg] = fs.realpathSync(pkgPath);
  }
}

// 7. Custom resolver for pnpm compatibility + exports bypass + React deduplication
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force React and related packages to resolve from project's node_modules
  // This prevents multiple React instances when dependencies from root node_modules
  // try to use their own React version (fixes ReactCurrentDispatcher errors)
  const baseModuleName = moduleName.split('/')[0];
  if (DEDUPE_PACKAGES.has(baseModuleName) && dedupeResolvedPaths[baseModuleName]) {
    // For subpath imports like 'react/jsx-runtime', resolve from project root
    const subpath = moduleName.slice(baseModuleName.length);
    const targetPath = dedupeResolvedPaths[baseModuleName] + subpath;
    try {
      const resolved = require.resolve(
        moduleName.startsWith('@') ? moduleName : baseModuleName + subpath,
        { paths: [projectRoot] }
      );
      return {
        filePath: resolved,
        type: 'sourceFile',
      };
    } catch (e) {
      // Fall through to default resolution
    }
  }

  // Bypass package exports for problematic CJS packages
  const pkgName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (FORCE_NO_EXPORTS.has(pkgName)) {
    // Resolve without package exports enabled for this module
    const contextWithoutExports = {
      ...context,
      unstable_enablePackageExports: false,
    };
    return context.resolveRequest(contextWithoutExports, moduleName, platform);
  }

  // Also check if originating module is inside one of these packages (self-referencing)
  if (context.originModulePath) {
    for (const pkg of FORCE_NO_EXPORTS) {
      if (context.originModulePath.includes(`/${pkg}/`)) {
        const contextWithoutExports = {
          ...context,
          unstable_enablePackageExports: false,
        };
        return context.resolveRequest(contextWithoutExports, moduleName, platform);
      }
    }
  }

  // Try default resolution first
  if (originalResolveRequest) {
    try {
      return originalResolveRequest(context, moduleName, platform);
    } catch (error) {
      // Fall through to custom resolution
    }
  }

  // For pnpm, try to resolve from the project's node_modules first
  const projectModulePath = path.resolve(projectRoot, 'node_modules', moduleName);
  if (fs.existsSync(projectModulePath)) {
    try {
      const realPath = fs.realpathSync(projectModulePath);
      return {
        filePath: require.resolve(moduleName, { paths: [projectRoot] }),
        type: 'sourceFile',
      };
    } catch (e) {
      // Fall through
    }
  }

  // Let Metro handle it
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

