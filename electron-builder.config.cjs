// @ts-check

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "app.speakmcp",
  productName: "SpeakMCP",
  directories: {
    buildResources: "build",
  },
  files: [
    "out/**/*",
    "node_modules/**/*",
    "package.json",
    "!**/.vscode/*",
    "!src/*",
    "!scripts/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!*.{js,cjs,mjs,ts}",
    "!components.json",
    "!.prettierrc",
    '!speakmcp-rs/*',
    "resources/**"
  ],
  asarUnpack: ["resources/**", "node_modules/**"],
  extraFiles: [
    {
      from: "resources/bin/speakmcp-rs",
      to: "Resources/app.asar.unpacked/resources/bin/speakmcp-rs"
    }
  ],
  win: {
    executableName: "speakmcp",
  },
  nsis: {
    artifactName: "${name}-${version}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always",
  },
  mac: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    entitlementsInherit: "build/entitlements.mac.plist",
    entitlements: "build/entitlements.mac.plist",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    identity: process.env.CSC_NAME || "Developer ID Application",
    category: "public.app-category.productivity",
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      },
      {
        target: "zip",
        arch: ["x64", "arm64"]
      }
    ],
    extendInfo: {
      NSCameraUsageDescription: "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription: "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription: "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription: "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "10.15.0",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "SpeakMCP Protocol",
          CFBundleURLSchemes: ["speakmcp"]
        }
      ]
    },
    notarize: process.env.APPLE_TEAM_ID && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD
      ? {
          teamId: process.env.APPLE_TEAM_ID,
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        }
      : false,
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    target: ["AppImage", "snap", "deb"],
    maintainer: "electronjs.org",
    category: "Utility",
  },
  appImage: {
    artifactName: "${name}-${version}.${ext}",
  },
  npmRebuild: false,
  publish: {
    provider: "github",
    owner: "aj47",
    repo: "SpeakMCP",
  },
  removePackageScripts: true,
}
