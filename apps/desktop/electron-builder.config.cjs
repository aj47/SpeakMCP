// @ts-check

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "app.speakmcp",
  productName: "SpeakMCP",
  icon: "build/icon.png",
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
    "!speakmcp-rs/*",
  ],
  asar: false,
  win: {
    icon: "build/icon.ico",
    executableName: "speakmcp",
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      },
      {
        target: "portable",
        arch: ["x64"]
      }
    ],
    artifactName: "${productName}-${version}-${arch}.${ext}",
    requestedExecutionLevel: "asInvoker",
    sign: null,
    signAndEditExecutable: false,
    signDlls: false,
    extraResources: [
      {
        from: "resources/bin/speakmcp-rs.exe",
        to: "bin/speakmcp-rs.exe",
        filter: ["**/*"]
      },
      {
        from: "build/icon.ico",
        to: "icon.ico"
      },
      {
        from: "../../packages/mcp-whatsapp/dist",
        to: "mcp-whatsapp/dist",
        filter: ["**/*"]
      },
      {
        from: "resources/bundled-skills",
        to: "bundled-skills",
        filter: ["**/*"]
      }
    ]
  },
  nsis: {
    artifactName: "${productName}-${version}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always",
  },
  portable: {
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    binaries: [
      "resources/bin/speakmcp-rs",
    ],
    extraResources: [
      {
        from: "../../packages/mcp-whatsapp/dist",
        to: "mcp-whatsapp/dist",
        filter: ["**/*"]
      },
      {
        from: "resources/bundled-skills",
        to: "bundled-skills",
        filter: ["**/*"]
      }
    ],
    artifactName: "${productName}-${version}-${arch}.${ext}",
    entitlementsInherit: "build/entitlements.mac.plist",
    identity: process.env.CSC_NAME || "Apple Development",
    // Disable hardened runtime and timestamp for development builds to avoid timestamp service errors
    // For production builds, set ENABLE_HARDENED_RUNTIME=true environment variable
    hardenedRuntime: process.env.ENABLE_HARDENED_RUNTIME === 'true',
    // Skip signing native extensions that cause timestamp issues
    signIgnore: [
      "node_modules/@egoist/electron-panel-window/build/Release/NativeExtension.node",
      // sherpa-onnx native libraries (already signed by package maintainers)
      "node_modules/sherpa-onnx-darwin-*/sherpa-onnx.node",
      "node_modules/sherpa-onnx-darwin-*/*.dylib"
    ],
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
      {
        target: "pkg",
        arch: ["x64", "arm64"],
      },
      // Temporarily disabled MAS build until installer certificate is available
      // {
      //   target: "mas",
      //   arch: ["arm64"]
      // }
    ],
    extendInfo: {
      NSCameraUsageDescription:
        "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription:
        "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription:
        "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription:
        "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "12.0.0",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "SpeakMCP Protocol",
          CFBundleURLSchemes: ["speakmcp"],
        },
      ],
    },
    notarize:
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD
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
      NSCameraUsageDescription:
        "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription:
        "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription:
        "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription:
        "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "12.0.0",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "SpeakMCP Protocol",
          CFBundleURLSchemes: ["speakmcp"],
        },
      ],
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
      NSCameraUsageDescription:
        "SpeakMCP may request camera access for enhanced AI features.",
      NSMicrophoneUsageDescription:
        "SpeakMCP requires microphone access for voice dictation and transcription.",
      NSDocumentsFolderUsageDescription:
        "SpeakMCP may access your Documents folder to save transcriptions and settings.",
      NSDownloadsFolderUsageDescription:
        "SpeakMCP may access your Downloads folder to save exported files.",
      LSMinimumSystemVersion: "10.15.0",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "SpeakMCP Protocol",
          CFBundleURLSchemes: ["speakmcp"],
        },
      ],
    },
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  pkg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity:
      process.env.CSC_INSTALLER_NAME ||
      process.env.CSC_NAME ||
      "Developer ID Application",
    allowAnywhere: false,
    allowCurrentUserHome: false,
    allowRootDirectory: false,
    isRelocatable: false,
    overwriteAction: "upgrade",
  },
  linux: {
    target: ["AppImage", "deb"],
    maintainer: "SpeakMCP <hi@techfren.net>",
    vendor: "SpeakMCP",
    category: "Utility",
    synopsis: "AI-powered voice assistant with MCP integration",
    description: "SpeakMCP is an AI-powered dictation and voice assistant tool with Model Context Protocol (MCP) integration for enhanced productivity.",
    desktop: {
      Name: "SpeakMCP",
      Comment: "AI-powered voice assistant with MCP integration",
      GenericName: "Voice Assistant",
      Keywords: "voice;dictation;ai;assistant;mcp;transcription;",
      Categories: "Utility;Audio;Development;",
      StartupWMClass: "speakmcp",
      StartupNotify: false,
      Terminal: false,
      Type: "Application",
    },
    executableName: "speakmcp",
    extraResources: [
      {
        from: "resources/bin/speakmcp-rs",
        to: "bin/speakmcp-rs",
        filter: ["**/*"]
      },
      {
        from: "../../packages/mcp-whatsapp/dist",
        to: "mcp-whatsapp/dist",
        filter: ["**/*"]
      },
      {
        from: "resources/bundled-skills",
        to: "bundled-skills",
        filter: ["**/*"]
      }
    ]
  },
  deb: {
    artifactName: "${productName}_${version}_${arch}.${ext}",
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0"
    ],
    recommends: [
      "libappindicator3-1",
      "pulseaudio"
    ],
    afterInstall: "build/linux/postinst.sh",
    afterRemove: "build/linux/postrm.sh",
  },
  appImage: {
    artifactName: "${productName}-${version}.${ext}",
  },
  npmRebuild: false,
  // After packing, clean up unnecessary files
  afterPack: async (context) => {
    const path = require('path');
    const fs = require('fs');

    // Find the app directory
    const appDir = path.join(context.appOutDir, 'resources', 'app');

    if (fs.existsSync(appDir)) {
      console.log('\n[AFTERPACK] Cleaning up unnecessary files...');
      console.log('[AFTERPACK] App directory:', appDir);

      try {
        // Remove lock files to reduce size
        const filesToRemove = ['bun.lock', 'pnpm-lock.yaml', 'package-lock.json'];
        for (const file of filesToRemove) {
          const filePath = path.join(appDir, file);
          if (fs.existsSync(filePath)) {
            console.log(`[AFTERPACK] Removing ${file}...`);
            fs.rmSync(filePath, { force: true });
          }
        }

        console.log('[AFTERPACK] Cleanup completed!\n');
      } catch (error) {
        console.error('[AFTERPACK] Cleanup failed:', error);
        // Don't throw - cleanup failures shouldn't block the build
      }
    }
  },
  publish: {
    provider: "github",
    owner: "aj47",
    repo: "SpeakMCP",
  },
  removePackageScripts: true,
}
