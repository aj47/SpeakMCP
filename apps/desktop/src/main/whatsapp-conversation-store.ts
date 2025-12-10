import fs from "fs"
import path from "path"
import { dataFolder } from "./config"
import { diagnosticsService } from "./diagnostics"

type Store = Record<string, { conversationId: string; updatedAt: number }>

const storePath = path.join(dataFolder, "whatsapp-conversations.json")

function readStore(): Store {
  try {
    const raw = fs.readFileSync(storePath, "utf8")
    const parsed = JSON.parse(raw) as Store
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  try {
    fs.mkdirSync(dataFolder, { recursive: true })
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
  } catch (error) {
    diagnosticsService.logWarning(
      "whatsapp-store",
      "Failed to persist WhatsApp conversation store",
      error,
    )
  }
}

function normalizeSender(sender: string): string {
  return String(sender || "").trim()
}

export function getConversationIdForWhatsAppSender(sender: string): string | undefined {
  const key = normalizeSender(sender)
  if (!key) return undefined
  const store = readStore()
  return store[key]?.conversationId
}

export function setConversationIdForWhatsAppSender(sender: string, conversationId: string) {
  const key = normalizeSender(sender)
  if (!key || !conversationId) return
  const store = readStore()
  store[key] = { conversationId, updatedAt: Date.now() }
  writeStore(store)
}

export function clearConversationForWhatsAppSender(sender: string) {
  const key = normalizeSender(sender)
  if (!key) return
  const store = readStore()
  if (store[key]) {
    delete store[key]
    writeStore(store)
  }
}

