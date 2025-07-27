// @ts-check

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "app.speakmcp",
  productName: "SpeakMCP",
  directories: {
    buildResources: "build",
  },
  files: [
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
    '!speakmcp-rs/*'
  ],
  asarUnpack: ["resources/**", "node_modules/**"],
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
    binaries: [`resources/bin/speakmcp-rs${process.platform === 'darwin' ? '' : '.exe'}`],
    artifactName: "${productName}-${version}-${arch}.${ext}",
    entitlementsInherit: "build/entitlements.mac.plist",
    identity: process.env.CSC_NAME || "Apple Development",
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      },
      {
        target: "zip",
        arch: ["x64", "arm64"]
      },
      {
        target: "pkg",
        arch: ["x64", "arm64"]
      }
      // Temporarily disabled MAS build until installer certificate is available
      // {
      //   target: "mas",
      //   arch: ["arm64"]
      // }
    ],
    extendInfo: {
      NSCameraUsageDescription: "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription: "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription: "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription: "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "12.0.0",
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
        }
      : undefined,
  },
  mas: {
    artifactName: "${productName}-${version}-mas.${ext}",
    entitlementsInherit: "build/entitlements.mas.inherit.plist",
    entitlements: "build/entitlements.mas.plist",
    hardenedRuntime: false,
    identity: process.env.CSC_MAS_NAME || "3rd Party Mac Developer Application",
    provisioningProfile: process.env.MAS_PROVISIONING_PROFILE,
    category: "public.app-category.productivity",
    type: "distribution",
    preAutoEntitlements: false,
    cscInstallerLink: process.env.CSC_INSTALLER_LINK,
    extendInfo: {
      NSCameraUsageDescription: "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription: "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription: "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription: "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "12.0.0",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "SpeakMCP Protocol",
          CFBundleURLSchemes: ["speakmcp"]
        }
      ]
    },
  },
  masDev: {
    artifactName: "${productName}-${version}-mas-dev.${ext}",
    entitlementsInherit: "build/entitlements.mas.inherit.plist",
    entitlements: "build/entitlements.mas.plist",
    hardenedRuntime: false,
    identity: process.env.CSC_MAS_DEV_NAME || "Mac Developer",
    provisioningProfile: process.env.MAS_DEV_PROVISIONING_PROFILE,
    category: "public.app-category.productivity",
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
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  pkg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity: process.env.CSC_INSTALLER_NAME || process.env.CSC_NAME || "Developer ID Application",
    allowAnywhere: false,
    allowCurrentUserHome: false,
    allowRootDirectory: false,
    isRelocatable: false,
    overwriteAction: "upgrade"
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
