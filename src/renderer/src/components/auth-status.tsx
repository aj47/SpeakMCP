import React from "react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { useAuthStateQuery, useInitiateLoginMutation, useLogoutMutation } from "@renderer/lib/query-client"
import { toast } from "sonner"

export function AuthStatus() {
  const authStateQuery = useAuthStateQuery()
  const initiateLoginMutation = useInitiateLoginMutation()
  const logoutMutation = useLogoutMutation()

  const handleLogin = async () => {
    try {
      await initiateLoginMutation.mutateAsync()
      toast.success("Successfully signed in!")
    } catch (error) {
      toast.error("Failed to sign in: " + (error as Error).message)
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

  const { user } = authStateQuery.data || {}

  if (user) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {user.avatar_url && (
            <img
              src={user.avatar_url}
              alt={user.name || user.email}
              className="h-5 w-5 rounded-full"
            />
          )}
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
      <div className="text-xs text-muted-foreground">Not signed in</div>
      <Button
        variant="default"
        size="sm"
        onClick={handleLogin}
        disabled={initiateLoginMutation.isPending}
        className="w-full h-6 text-xs"
      >
        {initiateLoginMutation.isPending ? "Signing in..." : "Sign in"}
      </Button>
    </div>
  )
}
