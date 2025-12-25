import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import { createLogger } from "./logger"

describe("logger", () => {
  let logSpy: MockInstance
  let warnSpy: MockInstance
  let errorSpy: MockInstance

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("createLogger", () => {
    it("should create a logger with the specified module name", () => {
      const logger = createLogger("test-module")
      expect(logger).toBeDefined()
      expect(logger.info).toBeInstanceOf(Function)
      expect(logger.warn).toBeInstanceOf(Function)
      expect(logger.error).toBeInstanceOf(Function)
      expect(logger.debug).toBeInstanceOf(Function)
      expect(logger.child).toBeInstanceOf(Function)
    })

    it("should log info messages", () => {
      const logger = createLogger("test-module")
      logger.info("Test message")

      expect(logSpy).toHaveBeenCalled()
      const logOutput = logSpy.mock.calls[0][0]
      expect(logOutput).toContain("test-module")
      expect(logOutput).toContain("Test message")
    })

    it("should log info messages with context", () => {
      const logger = createLogger("test-module")
      logger.info({ userId: "123", action: "test" }, "User action performed")

      expect(logSpy).toHaveBeenCalled()
      const logOutput = logSpy.mock.calls[0][0]
      expect(logOutput).toContain("test-module")
      expect(logOutput).toContain("User action performed")
      expect(logOutput).toContain("userId")
    })

    it("should log warnings", () => {
      const logger = createLogger("test-module")
      logger.warn("Warning message")

      expect(warnSpy).toHaveBeenCalled()
      const logOutput = warnSpy.mock.calls[0][0]
      // Check for lowercase "warn" (JSON format) or uppercase "WARN" (dev format)
      expect(logOutput.toLowerCase()).toContain("warn")
      expect(logOutput).toContain("Warning message")
    })

    it("should log errors", () => {
      const logger = createLogger("test-module")
      logger.error("Error message")

      expect(errorSpy).toHaveBeenCalled()
      const logOutput = errorSpy.mock.calls[0][0]
      // Check for lowercase "error" (JSON format) or uppercase "ERROR" (dev format)
      expect(logOutput.toLowerCase()).toContain("error")
      expect(logOutput).toContain("Error message")
    })

    it("should format Error objects correctly", () => {
      const logger = createLogger("test-module")
      const testError = new Error("Test error message")
      logger.error({ error: testError }, "An error occurred")

      expect(errorSpy).toHaveBeenCalled()
      const logOutput = errorSpy.mock.calls[0][0]
      expect(logOutput).toContain("Error")
      expect(logOutput).toContain("Test error message")
    })
  })

  describe("child logger", () => {
    it("should create a child logger with additional context", () => {
      const parentLogger = createLogger("parent-module")
      const childLogger = parentLogger.child({ requestId: "abc-123" })

      expect(childLogger).toBeDefined()
      expect(childLogger.info).toBeInstanceOf(Function)
    })

    it("should include parent context in child logs", () => {
      const parentLogger = createLogger("parent-module", { service: "api" })
      const childLogger = parentLogger.child({ requestId: "abc-123" })

      childLogger.info("Child log message")

      expect(logSpy).toHaveBeenCalled()
      const logOutput = logSpy.mock.calls[0][0]
      expect(logOutput).toContain("parent-module")
      expect(logOutput).toContain("Child log message")
    })
  })

  describe("log levels", () => {
    it("should support all log levels", () => {
      const logger = createLogger("test-module")

      // These should not throw
      expect(() => logger.debug("debug message")).not.toThrow()
      expect(() => logger.info("info message")).not.toThrow()
      expect(() => logger.warn("warn message")).not.toThrow()
      expect(() => logger.error("error message")).not.toThrow()
    })
  })
})
