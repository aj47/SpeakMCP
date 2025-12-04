import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery } from "@tanstack/react-query"

export default function Updater() {
  const infoQuery = useQuery({
    queryKey: ["update-info"],
    queryFn: async () => tipcClient.checkForUpdatesAndDownload(),
    refetchInterval: 1000 * 60 * 5,
  })

  const info = infoQuery.data

  if (!info?.downloadedUpdates || !info.updateInfo) return null

  return (
    <button
      type="button"
      className="fixed bottom-5 right-5 flex items-center justify-center gap-2 rounded-lg bg-green-500 p-2 px-3 text-center text-sm text-white transition-colors hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700"
      onClick={(e) => {
        tipcClient.quitAndInstall()
        e.currentTarget.classList.add("opacity-50", "pointer-events-none")
        e.currentTarget.setAttribute("disabled", "true")
      }}
    >
      <span className="i-mingcute-arrow-up-circle-fill text-base"></span>
      <span>Restart to update</span>
    </button>
  )
}
