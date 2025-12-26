import { logApp } from "./debug"

const MCP_REGISTRY_API = "https://registry.modelcontextprotocol.io/v0.1/servers"
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface RegistryServerPackage {
  registryType: "npm" | "pypi" | "oci"
  registryBaseUrl?: string
  identifier: string
  version?: string
  transport: {
    type: "stdio" | "streamable-http" | "sse"
  }
  environmentVariables?: Array<{
    name: string
    description?: string
    isSecret?: boolean
    format?: string
    default?: string
  }>
  args?: Array<{
    name: string
    description?: string
    isRequired?: boolean
    default?: string
  }>
}

export interface RegistryServerRemote {
  type: "streamable-http" | "sse"
  url: string
  variables?: Record<string, {
    description?: string
    isRequired?: boolean
    choices?: string[]
  }>
}

export interface RegistryServer {
  $schema?: string
  name: string
  description: string
  title?: string
  version: string
  repository?: {
    url?: string
    source?: string
  }
  websiteUrl?: string
  icons?: Array<{
    src: string
    mimeType?: string
    theme?: string
  }>
  packages?: RegistryServerPackage[]
  remotes?: RegistryServerRemote[]
}

export interface RegistryServerEntry {
  server: RegistryServer
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      status: string
      publishedAt: string
      updatedAt: string
      isLatest: boolean
    }
  }
}

export interface RegistryResponse {
  servers: RegistryServerEntry[]
  metadata: {
    nextCursor?: string
    count: number
  }
}

export interface ParsedRegistryServer {
  name: string
  displayName: string
  description: string
  version: string
  repositoryUrl?: string
  websiteUrl?: string
  iconUrl?: string
  isLatest: boolean
  publishedAt?: string
  transportType: "stdio" | "streamableHttp" | "sse"
  installType: "npm" | "pypi" | "oci" | "remote"
  npmPackage?: string
  pypiPackage?: string
  ociImage?: string
  remoteUrl?: string
  // Flag indicating if remote URL contains unresolved template placeholders (e.g., {var})
  hasUrlPlaceholders?: boolean
  // Variables required for remote URL template substitution
  remoteVariables?: Array<{
    name: string
    description?: string
    isRequired?: boolean
    choices?: string[]
  }>
  envVars?: Array<{
    name: string
    description?: string
    isSecret?: boolean
    default?: string
  }>
  args?: Array<{
    name: string
    description?: string
    isRequired?: boolean
    default?: string
  }>
}

let cachedServers: ParsedRegistryServer[] = []
let lastFetchTime = 0

function parseRegistryServer(entry: RegistryServerEntry): ParsedRegistryServer | null {
  const { server, _meta } = entry
  
  // Determine transport type and install method
  let transportType: "stdio" | "streamableHttp" | "sse" = "stdio"
  let installType: "npm" | "pypi" | "oci" | "remote" = "npm"
  let npmPackage: string | undefined
  let pypiPackage: string | undefined
  let ociImage: string | undefined
  let remoteUrl: string | undefined
  let hasUrlPlaceholders: boolean | undefined
  let remoteVariables: ParsedRegistryServer["remoteVariables"]
  let envVars: ParsedRegistryServer["envVars"]
  let args: ParsedRegistryServer["args"]

  // Check for remote servers first (they take priority if available)
  if (server.remotes && server.remotes.length > 0) {
    const remote = server.remotes[0]
    transportType = remote.type === "streamable-http" ? "streamableHttp" : "sse"
    installType = "remote"
    remoteUrl = remote.url
    
    // Detect if URL contains template placeholders like {var}
    hasUrlPlaceholders = /\{[^}]+\}/.test(remote.url)
    
    // Capture variables if defined
    if (remote.variables) {
      remoteVariables = Object.entries(remote.variables).map(([name, config]) => ({
        name,
        description: config.description,
        isRequired: config.isRequired,
        choices: config.choices,
      }))
    }
  } else if (server.packages && server.packages.length > 0) {
    const pkg = server.packages[0]
    
    if (pkg.transport.type === "stdio") {
      transportType = "stdio"
    } else if (pkg.transport.type === "streamable-http") {
      transportType = "streamableHttp"
    } else if (pkg.transport.type === "sse") {
      transportType = "sse"
    }

    if (pkg.registryType === "npm") {
      installType = "npm"
      npmPackage = pkg.identifier
    } else if (pkg.registryType === "pypi") {
      installType = "pypi"
      pypiPackage = pkg.identifier
    } else if (pkg.registryType === "oci") {
      installType = "oci"
      ociImage = pkg.identifier
    }

    envVars = pkg.environmentVariables?.map(ev => ({
      name: ev.name,
      description: ev.description,
      isSecret: ev.isSecret,
      default: ev.default,
    }))

    args = pkg.args?.map(a => ({
      name: a.name,
      description: a.description,
      isRequired: a.isRequired,
      default: a.default,
    }))
  } else {
    // No valid transport method
    return null
  }

  const isLatest = _meta?.["io.modelcontextprotocol.registry/official"]?.isLatest ?? true

  // Parse display name from the server name (e.g., "ai.exa/exa" -> "exa")
  const nameParts = server.name.split("/")
  const displayName = server.title || nameParts[nameParts.length - 1] || server.name

  return {
    name: server.name,
    displayName,
    description: server.description,
    version: server.version,
    repositoryUrl: server.repository?.url,
    websiteUrl: server.websiteUrl,
    iconUrl: server.icons?.[0]?.src,
    isLatest,
    publishedAt: _meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt,
    transportType,
    installType,
    npmPackage,
    pypiPackage,
    ociImage,
    remoteUrl,
    hasUrlPlaceholders,
    remoteVariables,
    envVars,
    args,
  }
}

export async function fetchRegistryServers(
  options: {
    search?: string
    forceRefresh?: boolean
  } = {}
): Promise<ParsedRegistryServer[]> {
  const { search, forceRefresh = false } = options
  const now = Date.now()

  // Return cached results if valid and no search filter
  if (!forceRefresh && !search && cachedServers.length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedServers
  }

  try {
    const allServers: ParsedRegistryServer[] = []
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 10 // Limit to prevent infinite loops

    do {
      const url = new URL(MCP_REGISTRY_API)
      if (search) {
        url.searchParams.set("search", search)
      }
      if (cursor) {
        url.searchParams.set("cursor", cursor)
      }

      logApp(`[mcp-registry] Fetching page ${pageCount + 1}: ${url.toString()}`)

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Registry API error: ${response.status} ${response.statusText}`)
      }

      const data: RegistryResponse = await response.json()
      
      for (const entry of data.servers) {
        const parsed = parseRegistryServer(entry)
        if (parsed) {
          allServers.push(parsed)
        }
      }

      cursor = data.metadata.nextCursor
      pageCount++
    } while (cursor && pageCount < maxPages)

    // Deduplicate by name, keeping only the latest version
    const serverMap = new Map<string, ParsedRegistryServer>()
    for (const server of allServers) {
      const existing = serverMap.get(server.name)
      if (!existing || server.isLatest) {
        serverMap.set(server.name, server)
      }
    }

    const uniqueServers = Array.from(serverMap.values())

    // Update cache if no search filter
    if (!search) {
      cachedServers = uniqueServers
      lastFetchTime = now
    }

    logApp(`[mcp-registry] Fetched ${uniqueServers.length} unique servers`)
    return uniqueServers
  } catch (error) {
    logApp(`[mcp-registry] Error fetching servers:`, error)
    throw error
  }
}

export function clearRegistryCache(): void {
  cachedServers = []
  lastFetchTime = 0
}
