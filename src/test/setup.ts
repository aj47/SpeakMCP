import "@testing-library/jest-dom"
import { vi, beforeAll, afterAll, describe, it, expect, beforeEach } from "vitest"

// Mock Electron APIs
global.window = global.window || {}

// Mock tipc client
vi.mock("@renderer/lib/tipc-client", () => ({
  tipcClient: {
    loadMcpConfigFile: vi.fn(),
    saveMcpConfigFile: vi.fn(),
    validateMcpConfig: vi.fn(),
    getMcpServerStatus: vi.fn(),
    testMcpServerConnection: vi.fn(),
    restartMcpServer: vi.fn(),
    stopMcpServer: vi.fn(),
    saveConfig: vi.fn(),
    getConfig: vi.fn(),
  },
}))

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

// Mock React Router
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/test" }),
  }
})

// Mock query client
vi.mock("@renderer/lib/query-client", () => ({
  useConfigQuery: () => ({
    data: {},
    isLoading: false,
    error: null,
  }),
}))

// Suppress console warnings in tests
const originalConsoleWarn = console.warn
const originalConsoleError = console.error

beforeAll(() => {
  console.warn = vi.fn()
  console.error = vi.fn()
})

afterAll(() => {
  console.warn = originalConsoleWarn
  console.error = originalConsoleError
})
