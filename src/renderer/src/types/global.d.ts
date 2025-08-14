import "@testing-library/jest-dom"
import "vitest/globals"

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeInTheDocument(): R
      toHaveTextContent(text: string): R
      toHaveClass(className: string): R
      toBeVisible(): R
    }
  }
}

export {}
