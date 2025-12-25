import { UseMutationOptions } from "@tanstack/react-query"
import { toast } from "sonner"
import { queryClient } from "./queries"

type MutationCallbacks<TData, TVariables> = {
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: Error, variables: TVariables) => void
}

interface StandardMutationConfig<TData, TVariables> {
  /** Query keys to invalidate on success */
  invalidateKeys?: string[][]
  /** Success message to show in toast */
  successMessage?: string | ((data: TData, variables: TVariables) => string)
  /** Error message prefix for toast */
  errorPrefix?: string
  /** Whether to show error toast (default: true) */
  showErrorToast?: boolean
  /** Whether to show success toast (default: true if successMessage provided) */
  showSuccessToast?: boolean
  /** Additional callbacks */
  callbacks?: MutationCallbacks<TData, TVariables>
}

/**
 * Creates standardized mutation options with consistent error handling,
 * cache invalidation, and toast notifications.
 *
 * @example
 * ```tsx
 * const mutation = useMutation({
 *   mutationFn: tipcClient.createProfile,
 *   ...createMutationOptions({
 *     invalidateKeys: [["profiles"]],
 *     successMessage: "Profile created",
 *     errorPrefix: "Failed to create profile",
 *   }),
 * })
 * ```
 */
export function createMutationOptions<TData = unknown, TVariables = void>(
  config: StandardMutationConfig<TData, TVariables>,
): Pick<
  UseMutationOptions<TData, Error, TVariables>,
  "onSuccess" | "onError" | "onSettled"
> {
  const {
    invalidateKeys = [],
    successMessage,
    errorPrefix = "Operation failed",
    showErrorToast = true,
    showSuccessToast = !!successMessage,
    callbacks,
  } = config

  return {
    onSuccess: (data: TData, variables: TVariables) => {
      // Invalidate specified query keys
      for (const queryKey of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey })
      }

      // Show success toast
      if (showSuccessToast && successMessage) {
        const message =
          typeof successMessage === "function"
            ? successMessage(data, variables)
            : successMessage
        toast.success(message)
      }

      // Call additional callback
      callbacks?.onSuccess?.(data, variables)
    },

    onError: (error: Error, variables: TVariables) => {
      // Show error toast
      if (showErrorToast) {
        toast.error(`${errorPrefix}: ${error.message}`)
      }

      // Call additional callback
      callbacks?.onError?.(error, variables)
    },
  }
}

/**
 * Creates mutation options with dialog close behavior.
 * Commonly used for create/edit dialogs that should close on success.
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false)
 *
 * const mutation = useMutation({
 *   mutationFn: tipcClient.createItem,
 *   ...createDialogMutationOptions({
 *     invalidateKeys: [["items"]],
 *     successMessage: "Item created",
 *     errorPrefix: "Failed to create item",
 *     onClose: () => setIsOpen(false),
 *   }),
 * })
 * ```
 */
export function createDialogMutationOptions<TData = unknown, TVariables = void>(
  config: StandardMutationConfig<TData, TVariables> & {
    /** Function to close the dialog on success */
    onClose: () => void
    /** Function to reset form state on success */
    onReset?: () => void
  },
): Pick<
  UseMutationOptions<TData, Error, TVariables>,
  "onSuccess" | "onError" | "onSettled"
> {
  const { onClose, onReset, ...rest } = config

  const baseOptions = createMutationOptions({
    ...rest,
    callbacks: {
      ...rest.callbacks,
      onSuccess: (data, variables) => {
        onClose()
        onReset?.()
        rest.callbacks?.onSuccess?.(data, variables)
      },
    },
  })

  return baseOptions
}

/**
 * Creates mutation options for delete operations with confirmation behavior.
 *
 * @example
 * ```tsx
 * const deleteMutation = useMutation({
 *   mutationFn: tipcClient.deleteItem,
 *   ...createDeleteMutationOptions({
 *     invalidateKeys: [["items"]],
 *     itemName: "profile",
 *   }),
 * })
 * ```
 */
export function createDeleteMutationOptions<
  TData = unknown,
  TVariables = void,
>(config: {
  invalidateKeys?: string[][]
  /** Name of the item being deleted (for messages) */
  itemName?: string
  /** Additional callbacks */
  callbacks?: MutationCallbacks<TData, TVariables>
}): Pick<
  UseMutationOptions<TData, Error, TVariables>,
  "onSuccess" | "onError" | "onSettled"
> {
  const { invalidateKeys = [], itemName = "item", callbacks } = config

  return createMutationOptions({
    invalidateKeys,
    successMessage: `${capitalize(itemName)} deleted`,
    errorPrefix: `Failed to delete ${itemName}`,
    callbacks,
  })
}

/**
 * Creates mutation options for update/save operations.
 *
 * @example
 * ```tsx
 * const updateMutation = useMutation({
 *   mutationFn: tipcClient.updateSettings,
 *   ...createUpdateMutationOptions({
 *     invalidateKeys: [["settings"]],
 *     itemName: "settings",
 *   }),
 * })
 * ```
 */
export function createUpdateMutationOptions<
  TData = unknown,
  TVariables = void,
>(config: {
  invalidateKeys?: string[][]
  /** Name of the item being updated (for messages) */
  itemName?: string
  /** Additional callbacks */
  callbacks?: MutationCallbacks<TData, TVariables>
}): Pick<
  UseMutationOptions<TData, Error, TVariables>,
  "onSuccess" | "onError" | "onSettled"
> {
  const { invalidateKeys = [], itemName = "item", callbacks } = config

  return createMutationOptions({
    invalidateKeys,
    successMessage: `${capitalize(itemName)} saved`,
    errorPrefix: `Failed to save ${itemName}`,
    callbacks,
  })
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
