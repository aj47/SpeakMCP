/**
 * GUI Unification Tests
 * Tests for the unified GUI experience implementation
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentProgress } from '../agent-progress'
import { AgentProcessingView } from '../agent-processing-view'
import { AgentProgressUpdate } from '../../../../shared/types'

// Mock the TIPC client
jest.mock('../../lib/tipc-client', () => ({
  tipcClient: {
    showMainWindow: jest.fn(),
  },
}))

// Mock the conversation context
jest.mock('../../contexts/conversation-context', () => ({
  useConversation: () => ({
    currentConversationId: 'test-conversation-id',
  }),
}))

describe('GUI Unification', () => {
  const mockProgress: AgentProgressUpdate = {
    currentIteration: 1,
    maxIterations: 3,
    steps: [],
    isComplete: false,
    conversationHistory: [],
  }

  const completedProgress: AgentProgressUpdate = {
    ...mockProgress,
    isComplete: true,
    finalContent: 'Test final content',
  }

  describe('Phase 1: Consolidated Processing UI', () => {
    it('should render AgentProcessingView consistently', () => {
      render(
        <AgentProcessingView
          agentProgress={mockProgress}
          isProcessing={true}
          variant="overlay"
          showBackgroundSpinner={true}
        />
      )

      // Should show processing state
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('should show background spinner when agent progress is active', () => {
      render(
        <AgentProcessingView
          agentProgress={mockProgress}
          isProcessing={true}
          showBackgroundSpinner={true}
        />
      )

      // Background spinner should be present
      const container = screen.getByRole('progressbar').closest('div')
      expect(container).toHaveClass('relative')
    })
  })

  describe('Phase 2: Results Transition CTA', () => {
    it('should show "View Full Results" button when complete with final content', () => {
      render(<AgentProgress progress={completedProgress} />)

      const ctaButton = screen.getByRole('button', { name: /view full results/i })
      expect(ctaButton).toBeInTheDocument()
      expect(ctaButton).toHaveTextContent('View Full Results')
    })

    it('should not show CTA button when not complete', () => {
      render(<AgentProgress progress={mockProgress} />)

      const ctaButton = screen.queryByRole('button', { name: /view full results/i })
      expect(ctaButton).not.toBeInTheDocument()
    })

    it('should not show CTA button when complete but no final content', () => {
      const progressWithoutContent = {
        ...mockProgress,
        isComplete: true,
        finalContent: undefined,
      }

      render(<AgentProgress progress={progressWithoutContent} />)

      const ctaButton = screen.queryByRole('button', { name: /view full results/i })
      expect(ctaButton).not.toBeInTheDocument()
    })

    it('should call showMainWindow with conversation ID when CTA clicked', () => {
      const { tipcClient } = require('../../lib/tipc-client')
      
      render(<AgentProgress progress={completedProgress} />)

      const ctaButton = screen.getByRole('button', { name: /view full results/i })
      fireEvent.click(ctaButton)

      expect(tipcClient.showMainWindow).toHaveBeenCalledWith({
        url: '/conversations/test-conversation-id'
      })
    })
  })

  describe('Phase 4: Mode Indicators', () => {
    it('should show appropriate status indicators', () => {
      render(<AgentProgress progress={mockProgress} />)

      // Should show "Working" status when not complete
      expect(screen.getByText('Working')).toBeInTheDocument()
    })

    it('should show completion status when complete', () => {
      render(<AgentProgress progress={completedProgress} />)

      // Should show "Complete" status when finished
      expect(screen.getByText('Complete')).toBeInTheDocument()
    })

    it('should show ESC hint when complete', () => {
      render(<AgentProgress progress={completedProgress} />)

      // Should show ESC hint
      expect(screen.getByText('ESC')).toBeInTheDocument()
    })
  })

  describe('Integration: Complete Flow', () => {
    it('should handle complete agent flow correctly', () => {
      const { rerender } = render(<AgentProgress progress={mockProgress} />)

      // Initially should show working state
      expect(screen.getByText('Working')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /view full results/i })).not.toBeInTheDocument()

      // After completion should show complete state with CTA
      rerender(<AgentProgress progress={completedProgress} />)

      expect(screen.getByText('Complete')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /view full results/i })).toBeInTheDocument()
      expect(screen.getByText('ESC')).toBeInTheDocument()
    })
  })
})
