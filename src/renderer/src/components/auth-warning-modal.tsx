import React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"
import { useInitiateLoginMutation } from "@renderer/lib/query-client"
import { toast } from "sonner"

interface AuthWarningModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "regular" | "mcp"
}

export function AuthWarningModal({ open, onOpenChange, mode = "regular" }: AuthWarningModalProps) {
  const initiateLoginMutation = useInitiateLoginMutation()

  const handleSignIn = async () => {
    try {
      await initiateLoginMutation.mutateAsync()
      toast.success("Successfully signed in!")
      onOpenChange(false)
    } catch (error) {
      toast.error("Failed to sign in: " + (error as Error).message)
    }
  }

  const modeText = mode === "mcp" ? "MCP tools" : "transcription"
  const modeDescription = mode === "mcp" 
    ? "To use MCP tools and AI assistance, you need to be signed in to SpeakMCP."
    : "To transcribe your recordings, you need to be signed in to SpeakMCP."

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="i-mingcute-lock-fill text-amber-500"></span>
            Authentication Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            {modeDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-start gap-3 text-sm">
            <span className="i-mingcute-check-circle-fill text-green-500 mt-0.5 flex-shrink-0"></span>
            <span>Free account with Google sign-in</span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <span className="i-mingcute-check-circle-fill text-green-500 mt-0.5 flex-shrink-0"></span>
            <span>Secure cloud-based {modeText}</span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <span className="i-mingcute-check-circle-fill text-green-500 mt-0.5 flex-shrink-0"></span>
            <span>No API keys required</span>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleSignIn}
            disabled={initiateLoginMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {initiateLoginMutation.isPending ? (
              <>
                <span className="i-mingcute-loading-fill animate-spin mr-2"></span>
                Signing In...
              </>
            ) : (
              <>
                <span className="i-mingcute-google-fill mr-2"></span>
                Sign In with Google
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
