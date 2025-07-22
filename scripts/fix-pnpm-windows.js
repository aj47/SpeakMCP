import fs from "fs"

if (process.platform === "win32") {
  const pnpmPath = process.env.npm_execpath
  
  if (!pnpmPath) {
    console.log("npm_execpath not found, skipping pnpm fix")
    process.exit(0)
  }

  try {
    const content = fs.readFileSync(pnpmPath, "utf8")
    const fixedContent = content.replace(/^#.+/, "#!node")
    fs.writeFileSync(pnpmPath, fixedContent)
    console.log("pnpm Windows fix applied successfully")
  } catch (error) {
    console.log("Failed to apply pnpm fix:", error.message)
  }
}
