import React, { useState, useEffect, useCallback } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Card } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Spinner } from "@renderer/components/ui/spinner"
import {
  Search,
  Globe,
  Package,
  Terminal,
  ExternalLink,
  RefreshCw,
  Check,
  AlertCircle,
} from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { MCPServerConfig, MCPTransportType } from "@shared/types"

interface ParsedRegistryServer {
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

// Helper function to generate a sanitized server name from a registry server
function getSanitizedServerName(server: ParsedRegistryServer): string {
  const nameParts = server.name.split("/")
  const baseName = nameParts[nameParts.length - 1] || server.displayName
  return baseName.replace(/[^a-zA-Z0-9-_]/g, "-")
}

// Check if a server is supported (SSE transport and URL placeholders are not supported)
// MCPTransportType in this codebase is "stdio" | "websocket" | "streamableHttp"
function isServerSupported(server: ParsedRegistryServer): { supported: boolean; reason?: string } {
  // SSE transport is not supported by this codebase (regardless of install type)
  if (server.transportType === "sse") {
    return { supported: false, reason: "SSE transport is not supported" }
  }
  
  // For remote servers, we only support streamableHttp
  if (server.installType === "remote" && server.transportType !== "streamableHttp") {
    return { supported: false, reason: "Only streamableHttp transport is supported for remote servers" }
  }
  
  // Remote URLs with template placeholders require manual configuration
  if (server.installType === "remote" && server.hasUrlPlaceholders) {
    return { supported: false, reason: "URL requires variable substitution" }
  }
  
  // For packages (npm/pypi/oci), we only support stdio transport
  if ((server.installType === "npm" || server.installType === "pypi" || server.installType === "oci") 
      && server.transportType !== "stdio") {
    return { supported: false, reason: "Only stdio transport is supported for packages" }
  }
  
  return { supported: true }
}

interface MCPRegistryBrowserProps {
  onSelectServer: (name: string, config: MCPServerConfig) => void
  existingServerNames: string[]
}

export function MCPRegistryBrowser({ onSelectServer, existingServerNames }: MCPRegistryBrowserProps) {
  const [servers, setServers] = useState<ParsedRegistryServer[]>([])
  const [filteredServers, setFilteredServers] = useState<ParsedRegistryServer[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installedServers, setInstalledServers] = useState<Set<string>>(new Set())

  const fetchServers = useCallback(async (forceRefresh = false) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await tipcClient.fetchMcpRegistryServers({ forceRefresh })
      setServers(result as ParsedRegistryServer[])
      setFilteredServers(result as ParsedRegistryServer[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch registry servers")
      toast.error("Failed to load MCP Registry")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  useEffect(() => {
    setInstalledServers(new Set(existingServerNames))
  }, [existingServerNames])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredServers(servers)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = servers.filter(
      (server) =>
        server.displayName.toLowerCase().includes(query) ||
        server.name.toLowerCase().includes(query) ||
        server.description.toLowerCase().includes(query)
    )
    setFilteredServers(filtered)
  }, [searchQuery, servers])

  const handleInstall = (server: ParsedRegistryServer) => {
    // Check if the server transport type is supported
    const supportCheck = isServerSupported(server)
    if (!supportCheck.supported) {
      toast.error(`${supportCheck.reason}. Please check the server's repository for alternative installation methods.`)
      return
    }

    // Generate a clean server name using the shared helper function
    let serverName = getSanitizedServerName(server)

    // Check if name already exists
    if (installedServers.has(serverName)) {
      let counter = 2
      while (installedServers.has(`${serverName}-${counter}`)) {
        counter++
      }
      serverName = `${serverName}-${counter}`
    }

    let config: MCPServerConfig

    if (server.installType === "remote" && server.remoteUrl) {
      // Remote server (streamableHttp only, SSE is filtered out by isServerSupported)
      // Validate that this is actually streamableHttp (not SSE)
      if (server.transportType !== "streamableHttp") {
        toast.error("Only streamableHttp transport is supported for remote servers.")
        return
      }
      config = {
        transport: "streamableHttp" as MCPTransportType,
        url: server.remoteUrl,
      }
    } else if (server.installType === "npm" && server.npmPackage) {
      // NPM package - only stdio is supported for package-based servers
      if (server.transportType !== "stdio") {
        toast.error("Only stdio transport is supported for npm packages. Please check the server's repository for alternative installation methods.")
        return
      }
      config = {
        transport: "stdio" as MCPTransportType,
        command: "npx",
        args: ["-y", server.npmPackage],
      }
    } else if (server.installType === "pypi" && server.pypiPackage) {
      // PyPI package - only stdio is supported for package-based servers
      if (server.transportType !== "stdio") {
        toast.error("Only stdio transport is supported for PyPI packages. Please check the server's repository for alternative installation methods.")
        return
      }
      config = {
        transport: "stdio" as MCPTransportType,
        command: "uvx",
        args: [server.pypiPackage],
      }
    } else if (server.installType === "oci" && server.ociImage) {
      // OCI container - only stdio is supported for package-based servers
      if (server.transportType !== "stdio") {
        toast.error("Only stdio transport is supported for Docker containers. Please check the server's repository for alternative installation methods.")
        return
      }
      config = {
        transport: "stdio" as MCPTransportType,
        command: "docker",
        args: ["run", "-i", "--rm", server.ociImage],
      }
    } else {
      toast.error("Unsupported server configuration")
      return
    }

    // Add environment variables if specified
    if (server.envVars && server.envVars.length > 0) {
      const env: Record<string, string> = {}
      for (const envVar of server.envVars) {
        // Use placeholder for required env vars
        env[envVar.name] = envVar.default || (envVar.isSecret ? "YOUR_API_KEY_HERE" : "")
      }
      if (Object.keys(env).length > 0) {
        config.env = env
      }
    }

    onSelectServer(serverName, config)
    toast.success(`Added "${server.displayName}" to configuration`)
  }

  const getInstallTypeIcon = (server: ParsedRegistryServer) => {
    switch (server.installType) {
      case "remote":
        return <Globe className="h-4 w-4" />
      case "npm":
      case "pypi":
        return <Package className="h-4 w-4" />
      case "oci":
        return <Terminal className="h-4 w-4" />
      default:
        return <Package className="h-4 w-4" />
    }
  }

  const getInstallTypeLabel = (server: ParsedRegistryServer) => {
    switch (server.installType) {
      case "remote":
        return "Remote"
      case "npm":
        return "npm"
      case "pypi":
        return "PyPI"
      case "oci":
        return "Docker"
      default:
        return server.installType
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner className="h-8 w-8 mb-4" />
        <p className="text-sm text-muted-foreground">Loading MCP Registry...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-sm text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={() => fetchServers(true)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search registry servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchServers(true)}
          title="Refresh registry"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {filteredServers.length} server{filteredServers.length !== 1 ? "s" : ""} available from the{" "}
        <a
          href="https://github.com/modelcontextprotocol/registry"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Official MCP Registry
        </a>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredServers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery ? "No servers match your search" : "No servers available"}
          </div>
        ) : (
          filteredServers.map((server) => {
            // Use the same sanitization logic as handleInstall for consistent "Installed" detection
            const sanitizedName = getSanitizedServerName(server)
            const isInstalled = installedServers.has(sanitizedName) ||
              // Also check for names with numeric suffixes (e.g., "server-2", "server-3")
              Array.from(installedServers).some(name => 
                name === sanitizedName || name.match(new RegExp(`^${sanitizedName}-\\d+$`))
              )
            const supportCheck = isServerSupported(server)
            const isSupported = supportCheck.supported

            return (
              <Card key={server.name} className={`p-3 ${!isSupported ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium text-sm truncate">
                        {server.displayName}
                      </h4>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {getInstallTypeIcon(server)}
                        <span className="ml-1">{getInstallTypeLabel(server)}</span>
                      </Badge>
                      {server.version && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          v{server.version}
                        </Badge>
                      )}
                      {!isSupported && supportCheck.reason && (
                        <Badge variant="destructive" className="text-xs shrink-0">
                          {supportCheck.reason}
                        </Badge>
                      )}
                      {isInstalled && isSupported && (
                        <Badge variant="default" className="text-xs shrink-0 bg-green-600">
                          <Check className="h-3 w-3 mr-1" />
                          Installed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {server.description}
                    </p>
                    {server.envVars && server.envVars.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Requires: {server.envVars.map((e) => e.name).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {server.repositoryUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => window.open(server.repositoryUrl, "_blank")}
                        title="View repository"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleInstall(server)}
                      disabled={!isSupported}
                      title={!isSupported ? supportCheck.reason : undefined}
                    >
                      {isInstalled ? "Add Again" : "Add"}
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
