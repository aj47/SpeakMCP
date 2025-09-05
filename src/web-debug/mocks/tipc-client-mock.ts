// Mock TIPC client for web debugging mode
import { createMockTipcClient, createMockRendererHandlers } from './electron-mocks'

// Create mock TIPC client and handlers
export const tipcClient = createMockTipcClient()
export const rendererHandlers = createMockRendererHandlers()

// Export the same interface as the real TIPC client
export default {
  tipcClient,
  rendererHandlers
}
