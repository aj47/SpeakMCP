/**
 * OAuth Server Configuration Component
 * 
 * Provides UI for configuring OAuth settings for MCP servers,
 * managing authentication flows, and displaying connection status.
 */

import React, { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Switch } from "@renderer/components/ui/switch"
import { Loader2, CheckCircle, XCircle, AlertCircle, ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { OAuthConfig } from "@shared/types"

interface OAuthServerConfigProps {
  serverName: string
  serverUrl: string
  oauthConfig?: OAuthConfig
  onConfigChange: (config: OAuthConfig) => void
  onTestConnection?: () => Promise<void>
  onStartAuth?: () => Promise<void>
  onRevokeAuth?: () => Promise<void>
}

interface OAuthStatus {
  configured: boolean
  authenticated: boolean
  tokenExpiry?: number
  error?: string
}

export function OAuthServerConfig({
  serverName,
  serverUrl,
  oauthConfig = {},
  onConfigChange,
  onTestConnection,
  onStartAuth,
  onRevokeAuth,
}: OAuthServerConfigProps) {
  const [config, setConfig] = useState<OAuthConfig>(oauthConfig)
  const [status, setStatus] = useState<OAuthStatus>({ configured: false, authenticated: false })
  const [isLoading, setIsLoading] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string>("")

  // Load OAuth status on mount
  useEffect(() => {
    loadOAuthStatus()
  }, [serverName])

  const loadOAuthStatus = async () => {
    try {
      const result = await window.electronAPI.getOAuthStatus(serverName)
      setStatus(result)
      if (result.error) {
        setError(result.error)
        toast.error(`OAuth status error: ${result.error}`)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setError(errorMsg)
      toast.error(`Failed to load OAuth status: ${errorMsg}`)
    }
  }

  const handleConfigChange = (updates: Partial<OAuthConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    onConfigChange(newConfig)
  }

  const handleStartAuth = async () => {
    if (!onStartAuth) return

    setIsAuthenticating(true)
    setError("")

    try {
      await onStartAuth()
      await loadOAuthStatus()
      toast.success("OAuth authentication completed successfully")
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setError(errorMsg)
      toast.error(`Authentication failed: ${errorMsg}`)
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleRevokeAuth = async () => {
    if (!onRevokeAuth) return

    setIsLoading(true)
    setError("")

    try {
      await onRevokeAuth()
      await loadOAuthStatus()
      toast.success("OAuth authentication revoked successfully")
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setError(errorMsg)
      toast.error(`Failed to revoke authentication: ${errorMsg}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTestConnection = async () => {
    if (!onTestConnection) return

    setIsLoading(true)
    setError("")

    try {
      await onTestConnection()
      toast.success("Connection test completed successfully")
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setError(errorMsg)
      toast.error(`Connection test failed: ${errorMsg}`)
    } finally {
      setIsLoading(false)
    }
  }

  const formatTokenExpiry = (expiry?: number) => {
    if (!expiry) return "Never"
    const date = new Date(expiry)
    const now = new Date()
    const diffMs = expiry - now.getTime()
    
    if (diffMs <= 0) return "Expired"
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''}`
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''}`
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`
  }

  const getStatusBadge = () => {
    if (status.authenticated) {
      return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Authenticated</Badge>
    } else if (status.configured) {
      return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" />Not Authenticated</Badge>
    } else {
      return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />Not Configured</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">OAuth Configuration</CardTitle>
            <CardDescription>
              Configure OAuth 2.1 authentication for {serverName}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            <Button
              variant="ghost"
              size="sm"
              onClick={loadOAuthStatus}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Authentication Status */}
        {status.configured && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Authentication Status</Label>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>
                <div className="mt-1">{getStatusBadge()}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Token Expires:</span>
                <div className="mt-1">{formatTokenExpiry(status.tokenExpiry)}</div>
              </div>
            </div>
          </div>
        )}

        {/* OAuth Settings */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">OAuth Settings</Label>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scope">Scope</Label>
              <Input
                id="scope"
                value={config.scope || ""}
                onChange={(e) => handleConfigChange({ scope: e.target.value })}
                placeholder="user"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID (Optional)</Label>
              <Input
                id="clientId"
                value={config.clientId || ""}
                onChange={(e) => handleConfigChange({ clientId: e.target.value })}
                placeholder="Auto-registered"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="useDiscovery"
              checked={config.useDiscovery !== false}
              onCheckedChange={(checked) => handleConfigChange({ useDiscovery: checked })}
            />
            <Label htmlFor="useDiscovery" className="text-sm">
              Use server metadata discovery (.well-known/oauth-authorization-server)
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="useDynamicRegistration"
              checked={config.useDynamicRegistration !== false}
              onCheckedChange={(checked) => handleConfigChange({ useDynamicRegistration: checked })}
            />
            <Label htmlFor="useDynamicRegistration" className="text-sm">
              Use dynamic client registration (RFC7591)
            </Label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!status.authenticated ? (
            <Button
              onClick={handleStartAuth}
              disabled={isAuthenticating || !serverUrl}
              className="flex items-center gap-2"
            >
              {isAuthenticating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              {isAuthenticating ? "Authenticating..." : "Start Authentication"}
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleRevokeAuth}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              Revoke Authentication
            </Button>
          )}

          {status.authenticated && onTestConnection && (
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Test Connection
            </Button>
          )}
        </div>

        {/* Server Information */}
        <div className="text-xs text-muted-foreground space-y-1">
          <div><strong>Server URL:</strong> {serverUrl}</div>
          {config.serverMetadata?.authorization_endpoint && (
            <div><strong>Authorization Endpoint:</strong> {config.serverMetadata.authorization_endpoint}</div>
          )}
          {config.serverMetadata?.token_endpoint && (
            <div><strong>Token Endpoint:</strong> {config.serverMetadata.token_endpoint}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
