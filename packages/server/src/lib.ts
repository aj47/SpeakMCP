/**
 * SpeakMCP Server - Library exports
 * Use this to embed the server in other applications
 */

export { startServer, stopServer, getServerStatus, type ServerOptions } from './server'
export { configStore, ensureDataDirs } from './config'
export { initDebugFlags } from './services/debug'

