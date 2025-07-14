import { spawn } from 'child_process'
import { platform } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function runBuildScript() {
  const isWindows = platform() === 'win32'
  
  let command, args
  
  if (isWindows) {
    command = 'cmd'
    args = ['/c', path.join(__dirname, 'build-rs.bat')]
  } else {
    command = 'sh'
    args = [path.join(__dirname, 'build-rs.sh')]
  }
  
  console.log(`Building Rust binary for ${isWindows ? 'Windows' : 'Unix'}...`)
  
  const buildProcess = spawn(command, args, {
    stdio: 'inherit',
    cwd: process.cwd()
  })
  
  buildProcess.on('error', (error) => {
    console.error('Failed to start build process:', error)
    process.exit(1)
  })
  
  buildProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Rust binary built successfully')
    } else {
      console.error(`❌ Build process exited with code ${code}`)
      process.exit(code)
    }
  })
}

runBuildScript()