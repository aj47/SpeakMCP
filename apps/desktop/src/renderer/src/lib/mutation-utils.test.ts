import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMutationOptions, createDialogMutationOptions, createDeleteMutationOptions, createUpdateMutationOptions } from "./mutation-utils"
import { toast } from "sonner"
import { queryClient } from "./queries"

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock queryClient
vi.mock("./queries", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}))

describe("mutation-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createMutationOptions", () => {
    it("should create mutation options with onSuccess and onError handlers", () => {
      const options = createMutationOptions({
        invalidateKeys: [["profiles"]],
        successMessage: "Success!",
        errorPrefix: "Failed",
      })

      expect(options.onSuccess).toBeInstanceOf(Function)
      expect(options.onError).toBeInstanceOf(Function)
    })

    it("should invalidate queries on success", () => {
      const options = createMutationOptions({
        invalidateKeys: [["profiles"], ["config"]],
        successMessage: "Profile created",
      })

      options.onSuccess?.({} as any, {} as any, {} as any)

      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["profiles"] })
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["config"] })
    })

    it("should show success toast on success", () => {
      const options = createMutationOptions({
        successMessage: "Item created successfully",
      })

      options.onSuccess?.({} as any, {} as any, {} as any)

      expect(toast.success).toHaveBeenCalledWith("Item created successfully")
    })

    it("should show error toast on error", () => {
      const options = createMutationOptions({
        errorPrefix: "Failed to create item",
      })

      const error = new Error("Network error")
      options.onError?.(error, {} as any, {} as any)

      expect(toast.error).toHaveBeenCalledWith("Failed to create item: Network error")
    })

    it("should support dynamic success messages", () => {
      const options = createMutationOptions<{ name: string }, { id: string }>({
        successMessage: (data) => `Created ${data.name}`,
      })

      options.onSuccess?.({ name: "Test Item" }, { id: "123" }, {} as any)

      expect(toast.success).toHaveBeenCalledWith("Created Test Item")
    })

    it("should call additional callbacks", () => {
      const onSuccessCallback = vi.fn()
      const onErrorCallback = vi.fn()

      const options = createMutationOptions({
        successMessage: "Success",
        callbacks: {
          onSuccess: onSuccessCallback,
          onError: onErrorCallback,
        },
      })

      options.onSuccess?.({} as any, {} as any, {} as any)
      expect(onSuccessCallback).toHaveBeenCalled()

      options.onError?.(new Error("test"), {} as any, {} as any)
      expect(onErrorCallback).toHaveBeenCalled()
    })

    it("should not show toasts when disabled", () => {
      const options = createMutationOptions({
        successMessage: "Success",
        showSuccessToast: false,
        showErrorToast: false,
      })

      options.onSuccess?.({} as any, {} as any, {} as any)
      expect(toast.success).not.toHaveBeenCalled()

      options.onError?.(new Error("test"), {} as any, {} as any)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe("createDialogMutationOptions", () => {
    it("should call onClose on success", () => {
      const onClose = vi.fn()
      const onReset = vi.fn()

      const options = createDialogMutationOptions({
        invalidateKeys: [["items"]],
        successMessage: "Item created",
        onClose,
        onReset,
      })

      options.onSuccess?.({} as any, {} as any, {} as any)

      expect(onClose).toHaveBeenCalled()
      expect(onReset).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith("Item created")
    })
  })

  describe("createDeleteMutationOptions", () => {
    it("should create delete-specific options", () => {
      const options = createDeleteMutationOptions({
        invalidateKeys: [["profiles"]],
        itemName: "profile",
      })

      options.onSuccess?.({} as any, {} as any, {} as any)

      expect(toast.success).toHaveBeenCalledWith("Profile deleted")
    })

    it("should show delete error message", () => {
      const options = createDeleteMutationOptions({
        itemName: "profile",
      })

      options.onError?.(new Error("Not found"), {} as any, {} as any)

      expect(toast.error).toHaveBeenCalledWith("Failed to delete profile: Not found")
    })
  })

  describe("createUpdateMutationOptions", () => {
    it("should create update-specific options", () => {
      const options = createUpdateMutationOptions({
        invalidateKeys: [["settings"]],
        itemName: "settings",
      })

      options.onSuccess?.({} as any, {} as any, {} as any)

      expect(toast.success).toHaveBeenCalledWith("Settings saved")
    })

    it("should show update error message", () => {
      const options = createUpdateMutationOptions({
        itemName: "config",
      })

      options.onError?.(new Error("Validation failed"), {} as any, {} as any)

      expect(toast.error).toHaveBeenCalledWith("Failed to save config: Validation failed")
    })
  })
})
