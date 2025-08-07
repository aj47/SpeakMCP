import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"
import { AgentProgress } from "../agent-progress"
import { AgentProgressUpdate } from "@shared/types"

// Mock the lucide-react icons
vi.mock("lucide-react", () => ({
  ChevronDown: () => <div data-testid="chevron-down" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
}))

// Mock the utils function
vi.mock("@renderer/lib/utils", () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}))

describe("AgentProgress", () => {
  const mockProgress: AgentProgressUpdate = {
    currentIteration: 1,
    maxIterations: 3,
    steps: [],
    isComplete: false,
    conversationHistory: [
      {
        role: "user",
        content: "Short message",
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content:
          "This is a longer message that should span multiple lines and trigger the collapse functionality when displayed in the agent progress view",
        timestamp: Date.now() + 1000,
      },
      {
        role: "tool",
        content: "Tool result with some data",
        timestamp: Date.now() + 2000,
        toolCalls: [{ name: "test-tool", arguments: { param: "value" } }],
        toolResults: [
          {
            success: true,
            content: "Tool executed successfully with detailed output",
          },
        ],
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders null when no progress provided", () => {
    const { container } = render(<AgentProgress progress={null} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders progress header correctly", () => {
    render(<AgentProgress progress={mockProgress} />)

    expect(screen.getByText("Working")).toBeInTheDocument()
    expect(screen.getByText("1/3")).toBeInTheDocument()
  })

  it("renders completed state correctly", () => {
    const completedProgress = { ...mockProgress, isComplete: true }
    render(<AgentProgress progress={completedProgress} />)

    expect(screen.getByText("Complete")).toBeInTheDocument()
    expect(screen.getByText("✓")).toBeInTheDocument()
    expect(screen.getByText("ESC")).toBeInTheDocument()
  })

  it("renders conversation messages with correct roles", () => {
    render(<AgentProgress progress={mockProgress} />)

    expect(screen.getByText("You")).toBeInTheDocument()
    expect(screen.getByText("Assistant")).toBeInTheDocument()
    expect(screen.getByText("Tool Result")).toBeInTheDocument()
  })

  it("makes text content selectable", () => {
    render(<AgentProgress progress={mockProgress} />)

    const messageContents = screen.getAllByRole("region")
    messageContents.forEach((content) => {
      expect(content).toHaveClass("select-text")
      expect(content).toHaveClass("cursor-text")
    })
  })

  it("shows messages collapsed by default for long content", () => {
    render(<AgentProgress progress={mockProgress} />)

    // Long assistant message should be collapsed by default
    const expandButtons = screen.getAllByRole("button")
    const assistantExpandButton = expandButtons.find((button) =>
      button.getAttribute("aria-label")?.includes("Expand"),
    )

    expect(assistantExpandButton).toBeInTheDocument()
    expect(assistantExpandButton).toHaveAttribute("aria-expanded", "false")
  })

  it("expands and collapses messages when button is clicked", async () => {
    render(<AgentProgress progress={mockProgress} />)

    const expandButtons = screen.getAllByLabelText(/Expand message/)
    const expandButton = expandButtons[0] // Use the first expand button

    // Initially collapsed
    expect(expandButton).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByTestId("chevron-right").length).toBeGreaterThan(0)

    // Click to expand
    fireEvent.click(expandButton)

    await waitFor(() => {
      expect(expandButton).toHaveAttribute("aria-expanded", "true")
      expect(expandButton).toHaveAttribute("aria-label", "Collapse message")
      expect(screen.getAllByTestId("chevron-down").length).toBeGreaterThan(0)
    })

    // Click to collapse
    fireEvent.click(expandButton)

    await waitFor(() => {
      expect(expandButton).toHaveAttribute("aria-expanded", "false")
      expect(expandButton).toHaveAttribute("aria-label", "Expand message")
    })
  })

  it("supports keyboard navigation for expand/collapse", async () => {
    render(<AgentProgress progress={mockProgress} />)

    const expandButtons = screen.getAllByLabelText(/Expand message/)
    const expandButton = expandButtons[0] // Use the first expand button

    // Test Enter key
    fireEvent.keyDown(expandButton, { key: "Enter" })

    await waitFor(() => {
      expect(expandButton).toHaveAttribute("aria-expanded", "true")
    })

    // Test Space key
    fireEvent.keyDown(expandButton, { key: " " })

    await waitFor(() => {
      expect(expandButton).toHaveAttribute("aria-expanded", "false")
    })
  })

  it("shows tool calls and results when expanded", async () => {
    render(<AgentProgress progress={mockProgress} />)

    // Find all expand buttons and click the last one (likely the tool message)
    const expandButtons = screen.getAllByLabelText(/Expand message/)
    const toolExpandButton = expandButtons[expandButtons.length - 1]

    fireEvent.click(toolExpandButton)

    await waitFor(() => {
      // Look for tool-related content
      expect(screen.getByText(/test-tool/)).toBeInTheDocument()
      expect(screen.getByText(/Tool executed successfully/)).toBeInTheDocument()
    })
  })

  it("applies correct styling for different message roles", () => {
    render(<AgentProgress progress={mockProgress} />)

    const messages = screen.getAllByRole("region")

    // Check that messages have appropriate styling classes
    messages.forEach((message) => {
      const parentDiv = message.closest(".liquid-glass-subtle")
      expect(parentDiv).toBeInTheDocument()
    })
  })

  it("shows single line preview by default", () => {
    render(<AgentProgress progress={mockProgress} />)

    // Find collapsed message content
    const messageContents = screen.getAllByRole("region")
    const collapsedContent = messageContents.find((content) =>
      content.classList.contains("line-clamp-1"),
    )

    expect(collapsedContent).toBeInTheDocument()
  })

  it("shows full content when expanded", async () => {
    render(<AgentProgress progress={mockProgress} />)

    const expandButtons = screen.getAllByLabelText(/Expand message/)
    const expandButton = expandButtons[0] // Use the first expand button
    fireEvent.click(expandButton)

    await waitFor(() => {
      const messageContents = screen.getAllByRole("region")
      const expandedContent = messageContents.find(
        (content) =>
          content.classList.contains("whitespace-pre-wrap") &&
          !content.classList.contains("line-clamp-1"),
      )

      expect(expandedContent).toBeInTheDocument()
    })
  })

  it("handles messages with newlines correctly", () => {
    const progressWithNewlines = {
      ...mockProgress,
      conversationHistory: [
        {
          role: "assistant" as const,
          content: "Line 1\nLine 2\nLine 3",
          timestamp: Date.now(),
        },
      ],
    }

    render(<AgentProgress progress={progressWithNewlines} />)

    // Should show expand button for content with newlines
    expect(screen.getByLabelText(/Expand message/)).toBeInTheDocument()
  })

  it("does not show expand button for short messages", () => {
    const progressWithShortMessage = {
      ...mockProgress,
      conversationHistory: [
        {
          role: "user" as const,
          content: "Hi",
          timestamp: Date.now(),
        },
      ],
    }

    render(<AgentProgress progress={progressWithShortMessage} />)

    // Should not show expand button for short content
    expect(screen.queryByLabelText(/Expand message/)).not.toBeInTheDocument()
  })

  it("maintains scroll functionality", () => {
    const { container } = render(<AgentProgress progress={mockProgress} />)

    const scrollContainer = container.querySelector(".overflow-y-auto")
    expect(scrollContainer).toBeInTheDocument()
    expect(scrollContainer).toHaveClass("scroll-smooth")
  })

  it("shows progress bar when not complete", () => {
    render(<AgentProgress progress={mockProgress} />)

    const progressBar = screen.getByRole("progressbar")
    expect(progressBar).toBeInTheDocument()
  })

  it("hides progress bar when complete", () => {
    const completedProgress = { ...mockProgress, isComplete: true }
    render(<AgentProgress progress={completedProgress} />)

    const progressBar = screen.queryByRole("progressbar")
    expect(progressBar).not.toBeInTheDocument()
  })
})
