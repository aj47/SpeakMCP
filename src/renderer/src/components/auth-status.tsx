import { Button } from "./ui/button"
import { useAuthStateQuery, useInitiateLoginMutation, useLogoutMutation, useCancelLoginMutation } from "@renderer/lib/query-client"
import { toast } from "sonner"

export function AuthStatus() {
  const authStateQuery = useAuthStateQuery()
  const initiateLoginMutation = useInitiateLoginMutation()
  const logoutMutation = useLogoutMutation()
  const cancelLoginMutation = useCancelLoginMutation()

  const { user } = authStateQuery.data || {}

  const handleLogin = async () => {
    try {
      // Reset any previous error state
      initiateLoginMutation.reset()
      await initiateLoginMutation.mutateAsync()
      toast.success("Successfully signed in!")
    } catch (error) {
      const errorMessage = (error as Error).message
      if (errorMessage.includes('timeout') || errorMessage.includes('browser was closed')) {
        toast.error("Sign in timed out or browser was closed. Please try again.")
      } else if (errorMessage.includes('Authentication failed') || errorMessage.includes('cancelled')) {
        toast.error("Authentication was cancelled or failed. Please try again.")
      } else {
        toast.error("Failed to sign in: " + errorMessage)
      }
    }
  }

  const handleCancelLogin = async () => {
    try {
      await cancelLoginMutation.mutateAsync()
      initiateLoginMutation.reset()
      toast.info("Sign in cancelled")
    } catch (error) {
      console.error("Failed to cancel login:", error)
    }
  }

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync()
      toast.success("Successfully signed out!")
    } catch (error) {
      toast.error("Failed to sign out: " + (error as Error).message)
    }
  }

  if (authStateQuery.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (user) {
    // Generate initials from name or email
    const getInitials = (name?: string, email?: string) => {
      if (name) {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
      }
      if (email) {
        return email[0].toUpperCase()
      }
      return 'U'
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
            {getInitials(user.name, user.email)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user.name || user.email}</div>
            <div className="text-xs text-muted-foreground">Authenticated</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          className="w-full h-6 text-xs"
        >
          {logoutMutation.isPending ? "Signing out..." : "Sign out"}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {initiateLoginMutation.isError ? "Sign in failed" : "Not signed in"}
      </div>
      {initiateLoginMutation.isPending ? (
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancelLogin}
            disabled={cancelLoginMutation.isPending}
            className="w-full h-6 text-xs"
          >
            {cancelLoginMutation.isPending ? "Cancelling..." : "Cancel"}
          </Button>
          <div className="text-xs text-muted-foreground text-center">
            Browser opened. Complete sign in or click Cancel.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleLogin}
            disabled={initiateLoginMutation.isPending}
            className="w-full h-6 text-xs"
          >
            {initiateLoginMutation.isError || initiateLoginMutation.isSuccess
              ? "Try again"
              : "Sign in"
            }
          </Button>
          <div className="text-xs text-muted-foreground text-center">
            Click to sign in with Google.
          </div>
        </div>
      )}
    </div>
  )
}
