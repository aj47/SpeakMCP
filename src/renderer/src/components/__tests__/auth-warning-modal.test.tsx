import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthWarningModal } from '../auth-warning-modal'
import { toast } from 'sonner'
import { vi } from 'vitest'

// Mock dependencies
vi.mock('@renderer/lib/query-client', () => ({
  useInitiateLoginMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false
  })
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

const mockToast = toast as any

describe('AuthWarningModal', () => {
  const mockOnOpenChange = jest.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render with regular mode by default', () => {
    render(
      <AuthWarningModal 
        open={true} 
        onOpenChange={mockOnOpenChange} 
      />
    )

    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
    expect(screen.getByText(/To transcribe your recordings/)).toBeInTheDocument()
    expect(screen.getByText('Sign In with Google')).toBeInTheDocument()
  })

  it('should render with MCP mode when specified', () => {
    render(
      <AuthWarningModal 
        open={true} 
        onOpenChange={mockOnOpenChange} 
        mode="mcp"
      />
    )

    expect(screen.getByText('Authentication Required')).toBeInTheDocument()
    expect(screen.getByText(/To use MCP tools and AI assistance/)).toBeInTheDocument()
    expect(screen.getByText('Sign In with Google')).toBeInTheDocument()
  })

  it('should show benefits of signing in', () => {
    render(
      <AuthWarningModal 
        open={true} 
        onOpenChange={mockOnOpenChange} 
      />
    )

    expect(screen.getByText('Free account with Google sign-in')).toBeInTheDocument()
    expect(screen.getByText('Secure cloud-based transcription')).toBeInTheDocument()
    expect(screen.getByText('No API keys required')).toBeInTheDocument()
  })

  it('should call onOpenChange when cancel is clicked', () => {
    render(
      <AuthWarningModal 
        open={true} 
        onOpenChange={mockOnOpenChange} 
      />
    )

    fireEvent.click(screen.getByText('Cancel'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('should handle sign in success', async () => {
    render(
      <AuthWarningModal 
        open={true} 
        onOpenChange={mockOnOpenChange} 
      />
    )

    fireEvent.click(screen.getByText('Sign In with Google'))

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Successfully signed in!')
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('should not render when open is false', () => {
    render(
      <AuthWarningModal 
        open={false} 
        onOpenChange={mockOnOpenChange} 
      />
    )

    expect(screen.queryByText('Authentication Required')).not.toBeInTheDocument()
  })
})
