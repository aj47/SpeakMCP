import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MCPConfigManager } from "../mcp-config-manager"
import { MCPConfig } from "@shared/types"
import { toast } from "sonner"

// Mock dependencies
vi.mock("@renderer/lib/tipc-client", () => ({
  tipcClient: {
    loadMcpConfigFile: vi.fn(),
    saveMcpConfigFile: vi.fn(),
    getMcpServerStatus: vi.fn(),
    restartMcpServer: vi.fn(),
    stopMcpServer: vi.fn(),
  },
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockTipcClient = require("@renderer/lib/tipc-client").tipcClient
const mockToast = toast as vi.Mocked<typeof toast>

describe("MCPConfigManager", () => {
  const mockOnConfigChange = vi.fn()

  const defaultConfig: MCPConfig = {
    mcpServers: {},
  }

  const configWithServers: MCPConfig = {
    mcpServers: {
      "test-server": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-test"],
        env: {
          API_KEY: "test-key",
        },
      },
      "disabled-server": {
        command: "echo",
        args: ["test"],
        disabled: true,
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTipcClient.getMcpServerStatus.mockResolvedValue({})
  })

  it("should render empty state when no servers are configured", () => {
    render(
      <MCPConfigManager
        config={defaultConfig}
        onConfigChange={mockOnConfigChange}
      />,
    )

    expect(
      screen.getByText(
        "No MCP servers configured. Add a server to get started.",
      ),
    ).toBeInTheDocument()
  })

  it("should render server cards when servers are configured", () => {
    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    expect(screen.getByText("test-server")).toBeInTheDocument()
    expect(screen.getByText("disabled-server")).toBeInTheDocument()
    expect(screen.getByText("Disabled")).toBeInTheDocument()
  })

  it("should open add server dialog when Add Server button is clicked", () => {
    render(
      <MCPConfigManager
        config={defaultConfig}
        onConfigChange={mockOnConfigChange}
      />,
    )

    fireEvent.click(screen.getByText("Add Server"))
    expect(screen.getByText("Add Server")).toBeInTheDocument()
    expect(screen.getByLabelText("Server Name")).toBeInTheDocument()
  })

  it("should open examples dialog when Examples button is clicked", () => {
    render(
      <MCPConfigManager
        config={defaultConfig}
        onConfigChange={mockOnConfigChange}
      />,
    )

    fireEvent.click(screen.getByText("Examples"))
    expect(screen.getByText("MCP Server Examples")).toBeInTheDocument()
    expect(screen.getByText("google-maps")).toBeInTheDocument()
  })

  it("should handle import config", async () => {
    const importedConfig = {
      mcpServers: {
        "imported-server": {
          command: "test",
          args: ["arg"],
        },
      },
    }

    mockTipcClient.loadMcpConfigFile.mockResolvedValue(importedConfig)

    render(
      <MCPConfigManager
        config={defaultConfig}
        onConfigChange={mockOnConfigChange}
      />,
    )

    fireEvent.click(screen.getByText("Import"))

    await waitFor(() => {
      expect(mockTipcClient.loadMcpConfigFile).toHaveBeenCalled()
      expect(mockOnConfigChange).toHaveBeenCalledWith(importedConfig)
      expect(mockToast.success).toHaveBeenCalledWith(
        "MCP configuration imported successfully",
      )
    })
  })

  it("should handle export config", async () => {
    mockTipcClient.saveMcpConfigFile.mockResolvedValue(true)

    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    fireEvent.click(screen.getByText("Export"))

    await waitFor(() => {
      expect(mockTipcClient.saveMcpConfigFile).toHaveBeenCalledWith({
        config: configWithServers,
      })
      expect(mockToast.success).toHaveBeenCalledWith(
        "MCP configuration exported successfully",
      )
    })
  })

  it("should handle server restart", async () => {
    mockTipcClient.restartMcpServer.mockResolvedValue({ success: true })

    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    const restartButton = screen.getAllByTitle("Restart server")[0]
    fireEvent.click(restartButton)

    await waitFor(() => {
      expect(mockTipcClient.restartMcpServer).toHaveBeenCalledWith({
        serverName: "test-server",
      })
      expect(mockToast.success).toHaveBeenCalledWith(
        "Server test-server restarted successfully",
      )
    })
  })

  it("should handle server stop", async () => {
    mockTipcClient.stopMcpServer.mockResolvedValue({ success: true })

    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    const stopButton = screen.getAllByTitle("Stop server")[0]
    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(mockTipcClient.stopMcpServer).toHaveBeenCalledWith({
        serverName: "test-server",
      })
      expect(mockToast.success).toHaveBeenCalledWith(
        "Server test-server stopped successfully",
      )
    })
  })

  it("should not show restart/stop buttons for disabled servers", () => {
    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    // Should have restart/stop buttons for enabled server
    expect(screen.getAllByTitle("Restart server")).toHaveLength(1)
    expect(screen.getAllByTitle("Stop server")).toHaveLength(1)

    // Should have edit/delete buttons for all servers
    expect(screen.getAllByTitle("Edit server")).toHaveLength(2)
    expect(screen.getAllByTitle("Delete server")).toHaveLength(2)
  })

  it("should handle server status updates", async () => {
    const serverStatus = {
      "test-server": {
        connected: true,
        toolCount: 5,
      },
    }

    mockTipcClient.getMcpServerStatus.mockResolvedValue(serverStatus)

    render(
      <MCPConfigManager
        config={configWithServers}
        onConfigChange={mockOnConfigChange}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("Connected (5 tools)")).toBeInTheDocument()
    })
  })
})
