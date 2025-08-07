import { useMicrphoneStatusQuery } from "@renderer/lib/query-client"
import { Button } from "@renderer/components/ui/button"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery } from "@tanstack/react-query"

export function Component() {
  const microphoneStatusQuery = useMicrphoneStatusQuery()
  const isAccessibilityGrantedQuery = useQuery({
    queryKey: ["setup-isAccessibilityGranted"],
    queryFn: () => tipcClient.isAccessibilityGranted(),
  })

  // Check if all required permissions are granted
  const microphoneGranted = microphoneStatusQuery.data === "granted"
  const accessibilityGranted = isAccessibilityGrantedQuery.data
  const allPermissionsGranted =
    microphoneGranted && (process.env.IS_MAC ? accessibilityGranted : true)

  return (
    <div className="app-drag-region flex h-dvh items-center justify-center p-10">
      <div className="-mt-20">
        <h1 className="text-center text-3xl font-extrabold">
          Welcome to {process.env.PRODUCT_NAME}
        </h1>
        <h2 className="mb-10 text-center text-neutral-500 dark:text-neutral-400">
          We need some system permissions before we can run the app
        </h2>
        <div className="mx-auto max-w-screen-md">
          <div className="grid divide-y rounded-lg border">
            {process.env.IS_MAC && (
              <PermissionBlock
                title="Accessibility Access"
                description={`We need Accessibility Access to capture keyboard events, so that you can hold Ctrl key to start recording, we don't log or store your keyboard events.`}
                actionText="Enable in System Settings"
                actionHandler={() => {
                  tipcClient.requestAccesssbilityAccess()
                }}
                enabled={isAccessibilityGrantedQuery.data}
              />
            )}

            <PermissionBlock
              title="Microphone Access"
              description={`We need Microphone Access to record your microphone, recordings are store locally on your computer only.`}
              actionText={
                microphoneStatusQuery.data === "denied"
                  ? "Enable in System Settings"
                  : "Request Access"
              }
              actionHandler={async () => {
                const granted = await tipcClient.requestMicrophoneAccess()
                if (!granted) {
                  tipcClient.openMicrophoneInSystemPreferences()
                }
              }}
              enabled={microphoneStatusQuery.data === "granted"}
            />
          </div>
        </div>

        {/* Show restart instructions when permissions are granted */}
        {allPermissionsGranted && (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-950">
            <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-300">
              <span className="i-mingcute-check-circle-fill text-lg"></span>
              <span className="font-semibold">All permissions granted!</span>
            </div>
            <p className="mt-2 text-sm text-green-600 dark:text-green-400">
              Please restart the app to complete the setup and start using{" "}
              {process.env.PRODUCT_NAME}.
            </p>
          </div>
        )}

        <div className="mt-10 flex items-center justify-center">
          <Button
            variant={allPermissionsGranted ? "default" : "outline"}
            className={`gap-2 ${allPermissionsGranted ? "animate-pulse bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800" : ""}`}
            onClick={() => {
              tipcClient.restartApp()
            }}
          >
            <span className="i-mingcute-refresh-2-line"></span>
            <span>
              {allPermissionsGranted ? "Restart App Now" : "Restart App"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}

const PermissionBlock = ({
  title,
  description,
  actionHandler,
  actionText,
  enabled,
}: {
  title: React.ReactNode
  description: React.ReactNode
  actionText: string
  actionHandler: () => void
  enabled?: boolean
}) => {
  return (
    <div className="grid grid-cols-2 gap-5 p-3">
      <div>
        <div className="text-lg font-bold">{title}</div>
        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {description}
        </div>
      </div>
      <div className="flex items-center justify-end">
        {enabled ? (
          <div className="inline-flex items-center gap-1 text-green-500">
            <span className="i-mingcute-check-fill"></span>
            <span>Granted</span>
          </div>
        ) : (
          <Button type="button" onClick={actionHandler}>
            {actionText}
          </Button>
        )}
      </div>
    </div>
  )
}
