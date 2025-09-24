import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DebugLogsManager } from '../debug-logs-manager'
import { tipcClient } from '@renderer/lib/tipc-client'
import { toast } from 'sonner'

// Mock dependencies
jest.mock('@renderer/lib/tipc-client')
jest.mock('sonner')

const mockTipcClient = tipcClient as jest.Mocked<typeof tipcClient>
const mockToast = toast as jest.Mocked<typeof toast>

// Mock data
const mockLogs = [
  {
    timestamp: Date.now() - 1000,
    level: 'info' as const,
    component: 'app',
    message: 'Application started',
    details: { version: '1.0.0' }
  },
  {
    timestamp: Date.now() - 2000,
    level: 'error' as const,
    component: 'mcp',
    message: 'Connection failed',
    stack: 'Error: Connection failed\n    at test.js:1:1'
  },
  {
    timestamp: Date.now() - 3000,
    level: 'debug' as const,
    component: 'llm',
    message: 'Processing request'
  }
]

const mockStats = {
  totalSize: '1.2 MB',
  fileCount: 3,
  oldestLog: '2023-01-01',
  newestLog: '2023-01-03'
}

const mockConfig = {
  debugLoggingEnabled: true,
  debugLoggingLevel: 'info' as const,
  debugLoggingMaxFileSize: 10,
  debugLoggingMaxFiles: 5
}

describe('DebugLogsManager', () => {
  let queryClient: QueryClient
  let mockOnConfigChange: jest.Mock

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    mockOnConfigChange = jest.fn()

    // Setup default mocks
    mockTipcClient.getDebugLogs.mockResolvedValue(mockLogs)
    mockTipcClient.getDebugLogStats.mockResolvedValue(mockStats)
    mockTipcClient.clearDebugLogs.mockResolvedValue({ success: true })
    mockTipcClient.exportDebugLogs.mockResolvedValue({ path: '/tmp/export.json' })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const renderComponent = (config = mockConfig) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <DebugLogsManager config={config} onConfigChange={mockOnConfigChange} />
      </QueryClientProvider>
    )
  }

  describe('Configuration Section', () => {
    it('should render configuration controls', () => {
      renderComponent()

      expect(screen.getByLabelText('Enable Debug Logging')).toBeInTheDocument()
      expect(screen.getByLabelText('Log Level')).toBeInTheDocument()
      expect(screen.getByLabelText('Max File Size (MB)')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Files to Keep')).toBeInTheDocument()
    })

    it('should call onConfigChange when debug logging is toggled', () => {
      renderComponent()

      const toggle = screen.getByLabelText('Enable Debug Logging')
      fireEvent.click(toggle)

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        debugLoggingEnabled: false
      })
    })

    it('should call onConfigChange when log level is changed', () => {
      renderComponent()

      const select = screen.getByDisplayValue('Info')
      fireEvent.click(select)
      
      const debugOption = screen.getByText('Debug')
      fireEvent.click(debugOption)

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        debugLoggingLevel: 'debug'
      })
    })

    it('should disable controls when debug logging is disabled', () => {
      renderComponent({
        ...mockConfig,
        debugLoggingEnabled: false
      })

      expect(screen.getByLabelText('Log Level')).toBeDisabled()
      expect(screen.getByLabelText('Max File Size (MB)')).toBeDisabled()
      expect(screen.getByLabelText('Max Files to Keep')).toBeDisabled()
    })
  })

  describe('Statistics Display', () => {
    it('should display log statistics', async () => {
      renderComponent()

      await waitFor(() => {
        expect(screen.getByText('1.2 MB')).toBeInTheDocument()
        expect(screen.getByText('3')).toBeInTheDocument()
        expect(screen.getByText('2023-01-01')).toBeInTheDocument()
        expect(screen.getByText('2023-01-03')).toBeInTheDocument()
      })
    })
  })

  describe('Log Display', () => {
    it('should display log entries', async () => {
      renderComponent()

      await waitFor(() => {
        expect(screen.getByText('Application started')).toBeInTheDocument()
        expect(screen.getByText('Connection failed')).toBeInTheDocument()
        expect(screen.getByText('Processing request')).toBeInTheDocument()
      })
    })

    it('should display log levels with correct badges', async () => {
      renderComponent()

      await waitFor(() => {
        expect(screen.getByText('INFO')).toBeInTheDocument()
        expect(screen.getByText('ERROR')).toBeInTheDocument()
        expect(screen.getByText('DEBUG')).toBeInTheDocument()
      })
    })

    it('should display component badges', async () => {
      renderComponent()

      await waitFor(() => {
        expect(screen.getByText('app')).toBeInTheDocument()
        expect(screen.getByText('mcp')).toBeInTheDocument()
        expect(screen.getByText('llm')).toBeInTheDocument()
      })
    })

    it('should show details when expanded', async () => {
      renderComponent()

      await waitFor(() => {
        const detailsButton = screen.getByText('Show details')
        fireEvent.click(detailsButton)
        expect(screen.getByText('"version": "1.0.0"')).toBeInTheDocument()
      })
    })

    it('should show stack trace for errors when expanded', async () => {
      renderComponent()

      await waitFor(() => {
        const stackButton = screen.getByText('Show stack trace')
        fireEvent.click(stackButton)
        expect(screen.getByText(/Error: Connection failed/)).toBeInTheDocument()
      })
    })
  })

  describe('Search and Filtering', () => {
    it('should filter logs by search query', async () => {
      renderComponent()

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText('Search logs...')
        fireEvent.change(searchInput, { target: { value: 'Application' } })
      })

      await waitFor(() => {
        expect(screen.getByText('Application started')).toBeInTheDocument()
        expect(screen.queryByText('Connection failed')).not.toBeInTheDocument()
      })
    })

    it('should filter logs by level', async () => {
      renderComponent()

      await waitFor(() => {
        const levelFilter = screen.getByDisplayValue('All Levels')
        fireEvent.click(levelFilter)
        
        const errorOption = screen.getByText('Error')
        fireEvent.click(errorOption)
      })

      await waitFor(() => {
        expect(screen.queryByText('Application started')).not.toBeInTheDocument()
        expect(screen.getByText('Connection failed')).toBeInTheDocument()
        expect(screen.queryByText('Processing request')).not.toBeInTheDocument()
      })
    })

    it('should filter logs by component', async () => {
      renderComponent()

      await waitFor(() => {
        const componentFilter = screen.getByDisplayValue('All Components')
        fireEvent.click(componentFilter)
        
        const mcpOption = screen.getByText('mcp')
        fireEvent.click(mcpOption)
      })

      await waitFor(() => {
        expect(screen.queryByText('Application started')).not.toBeInTheDocument()
        expect(screen.getByText('Connection failed')).toBeInTheDocument()
        expect(screen.queryByText('Processing request')).not.toBeInTheDocument()
      })
    })
  })

  describe('Actions', () => {
    it('should refresh logs when refresh button is clicked', async () => {
      renderComponent()

      await waitFor(() => {
        const refreshButton = screen.getByText('Refresh')
        fireEvent.click(refreshButton)
      })

      expect(mockTipcClient.getDebugLogs).toHaveBeenCalledTimes(2) // Initial + refresh
      expect(mockTipcClient.getDebugLogStats).toHaveBeenCalledTimes(2)
    })

    it('should export logs when export button is clicked', async () => {
      renderComponent()

      await waitFor(() => {
        const exportButton = screen.getByText('Export')
        fireEvent.click(exportButton)
      })

      expect(mockTipcClient.exportDebugLogs).toHaveBeenCalled()
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith(
          'Debug logs exported to: /tmp/export.json'
        )
      })
    })

    it('should clear logs when clear button is clicked', async () => {
      renderComponent()

      await waitFor(() => {
        const clearButton = screen.getByText('Clear')
        fireEvent.click(clearButton)
      })

      expect(mockTipcClient.clearDebugLogs).toHaveBeenCalled()
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith('Debug logs cleared')
      })
    })

    it('should disable export and clear buttons when debug logging is disabled', () => {
      renderComponent({
        ...mockConfig,
        debugLoggingEnabled: false
      })

      expect(screen.getByText('Export')).toBeDisabled()
      expect(screen.getByText('Clear')).toBeDisabled()
    })
  })

  describe('Error Handling', () => {
    it('should show error toast when fetching logs fails', async () => {
      mockTipcClient.getDebugLogs.mockRejectedValue(new Error('Fetch failed'))
      
      renderComponent()

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to fetch debug logs')
      })
    })

    it('should show error toast when clearing logs fails', async () => {
      mockTipcClient.clearDebugLogs.mockRejectedValue(new Error('Clear failed'))
      
      renderComponent()

      await waitFor(() => {
        const clearButton = screen.getByText('Clear')
        fireEvent.click(clearButton)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to clear debug logs')
      })
    })

    it('should show error toast when exporting logs fails', async () => {
      mockTipcClient.exportDebugLogs.mockRejectedValue(new Error('Export failed'))
      
      renderComponent()

      await waitFor(() => {
        const exportButton = screen.getByText('Export')
        fireEvent.click(exportButton)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to export debug logs')
      })
    })
  })

  describe('Empty States', () => {
    it('should show message when debug logging is disabled', () => {
      renderComponent({
        ...mockConfig,
        debugLoggingEnabled: false
      })

      expect(screen.getByText('Debug logging is disabled. Enable it to see logs.')).toBeInTheDocument()
    })

    it('should show message when no logs are available', async () => {
      mockTipcClient.getDebugLogs.mockResolvedValue([])
      
      renderComponent()

      await waitFor(() => {
        expect(screen.getByText('No debug logs available.')).toBeInTheDocument()
      })
    })

    it('should show message when no logs match search criteria', async () => {
      renderComponent()

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText('Search logs...')
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
      })

      await waitFor(() => {
        expect(screen.getByText('No logs match your search criteria.')).toBeInTheDocument()
      })
    })
  })
})
