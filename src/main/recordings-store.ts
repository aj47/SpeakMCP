import fs from "fs"
import path from "path"
import { recordingsFolder } from "./config"
import { RecordingHistoryItem } from "../shared/types"

export const getRecordingHistory = (): RecordingHistoryItem[] => {
  try {
    const history = JSON.parse(
      fs.readFileSync(path.join(recordingsFolder, "history.json"), "utf8"),
    ) as RecordingHistoryItem[]

    // sort desc by createdAt
    return history.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export const saveRecordingHistory = (history: RecordingHistoryItem[]) => {
  fs.writeFileSync(
    path.join(recordingsFolder, "history.json"),
    JSON.stringify(history),
  )
}

