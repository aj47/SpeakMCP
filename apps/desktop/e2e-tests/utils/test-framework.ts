/**
 * SpeakMCP E2E Test Framework
 *
 * Utilities for running E2E tests via Electron CDP/MCP
 *
 * Usage: Tests are executed via the electron-native MCP server which
 * provides access to electron_execute for running JS in the renderer.
 */

export interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface TestSuite {
  name: string;
  category: string;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  description: string;
  code: string;
  expected?: unknown;
  timeout?: number;
}

export interface TestContext {
  results: TestResult[];
  startTime: number;
  currentSuite: string;
}

/**
 * Creates JavaScript code that can be executed via electron_execute
 * to run a test and return results
 */
export function createTestCode(test: TestCase): string {
  return `
(async () => {
  const testStart = Date.now();
  try {
    const result = await (async () => {
      ${test.code}
    })();
    return {
      name: ${JSON.stringify(test.name)},
      passed: true,
      result,
      duration: Date.now() - testStart
    };
  } catch (error) {
    return {
      name: ${JSON.stringify(test.name)},
      passed: false,
      error: error.message || String(error),
      duration: Date.now() - testStart
    };
  }
})();
`;
}

/**
 * Test assertion helpers - these run in the renderer context
 */
export const assertions = `
const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || \`Expected \${JSON.stringify(expected)} but got \${JSON.stringify(actual)}\`);
    }
  },
  deepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message || \`Deep equality failed: \${JSON.stringify(actual)} !== \${JSON.stringify(expected)}\`);
    }
  },
  truthy(value, message) {
    if (!value) {
      throw new Error(message || \`Expected truthy value but got \${JSON.stringify(value)}\`);
    }
  },
  falsy(value, message) {
    if (value) {
      throw new Error(message || \`Expected falsy value but got \${JSON.stringify(value)}\`);
    }
  },
  contains(array, item, message) {
    if (!Array.isArray(array) || !array.includes(item)) {
      throw new Error(message || \`Expected array to contain \${JSON.stringify(item)}\`);
    }
  },
  hasProperty(obj, prop, message) {
    if (!obj || !(prop in obj)) {
      throw new Error(message || \`Expected object to have property "\${prop}"\`);
    }
  },
  isArray(value, message) {
    if (!Array.isArray(value)) {
      throw new Error(message || \`Expected array but got \${typeof value}\`);
    }
  },
  isObject(value, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(message || \`Expected object but got \${typeof value}\`);
    }
  },
  isString(value, message) {
    if (typeof value !== 'string') {
      throw new Error(message || \`Expected string but got \${typeof value}\`);
    }
  },
  isNumber(value, message) {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(message || \`Expected number but got \${typeof value}\`);
    }
  },
  isBoolean(value, message) {
    if (typeof value !== 'boolean') {
      throw new Error(message || \`Expected boolean but got \${typeof value}\`);
    }
  },
  isFunction(value, message) {
    if (typeof value !== 'function') {
      throw new Error(message || \`Expected function but got \${typeof value}\`);
    }
  },
  throws(fn, message) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) {
      throw new Error(message || 'Expected function to throw');
    }
  },
  async rejects(promise, message) {
    let rejected = false;
    try { await promise; } catch { rejected = true; }
    if (!rejected) {
      throw new Error(message || 'Expected promise to reject');
    }
  },
  matchesRegex(value, regex, message) {
    if (typeof value !== 'string' || !regex.test(value)) {
      throw new Error(message || \`Expected "\${value}" to match \${regex}\`);
    }
  },
  greaterThan(actual, expected, message) {
    if (actual <= expected) {
      throw new Error(message || \`Expected \${actual} > \${expected}\`);
    }
  },
  lessThan(actual, expected, message) {
    if (actual >= expected) {
      throw new Error(message || \`Expected \${actual} < \${expected}\`);
    }
  },
  lengthOf(value, length, message) {
    if (!value || value.length !== length) {
      throw new Error(message || \`Expected length \${length} but got \${value?.length}\`);
    }
  },
  exists(value, message) {
    if (value === null || value === undefined) {
      throw new Error(message || 'Expected value to exist');
    }
  }
};
`;

/**
 * Helper to wrap test code with assertions
 */
export function wrapWithAssertions(code: string): string {
  return `${assertions}\n${code}`;
}

/**
 * Helper utilities available in test context
 */
export const testHelpers = `
const helpers = {
  // Wait for a condition to be true
  async waitFor(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(\`Timeout waiting for condition after \${timeout}ms\`);
  },

  // Wait for an element to appear
  async waitForElement(selector, timeout = 5000) {
    return this.waitFor(() => document.querySelector(selector), timeout);
  },

  // Wait for element to have specific text
  async waitForText(selector, text, timeout = 5000) {
    return this.waitFor(() => {
      const el = document.querySelector(selector);
      return el && el.textContent?.includes(text);
    }, timeout);
  },

  // Click an element
  click(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(\`Element not found: \${selector}\`);
    el.click();
    return true;
  },

  // Type into an input
  type(selector, value) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(\`Input not found: \${selector}\`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },

  // Get element text
  getText(selector) {
    const el = document.querySelector(selector);
    return el?.textContent || null;
  },

  // Get all elements matching selector
  getAll(selector) {
    return Array.from(document.querySelectorAll(selector));
  },

  // Navigate to route
  async navigate(route) {
    window.location.hash = route;
    await new Promise(r => setTimeout(r, 300));
    return window.location.hash;
  },

  // Get current route
  getRoute() {
    return window.location.hash.replace('#', '') || '/';
  },

  // IPC invoke helper
  async ipc(method, ...args) {
    return window.electron.ipcRenderer.invoke(method, ...args);
  },

  // Store in state for cross-test persistence
  setState(key, value) {
    if (!window.__testState) window.__testState = {};
    window.__testState[key] = value;
  },

  getState(key) {
    return window.__testState?.[key];
  },

  // Take DOM snapshot
  snapshot(selector = 'body') {
    const el = document.querySelector(selector);
    return el?.innerHTML || '';
  },

  // Get computed style
  getStyle(selector, property) {
    const el = document.querySelector(selector);
    if (!el) return null;
    return getComputedStyle(el)[property];
  },

  // Check visibility
  isVisible(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  },

  // Trigger keyboard event
  keyPress(key, modifiers = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      code: key,
      ctrlKey: modifiers.ctrl || false,
      metaKey: modifiers.meta || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      bubbles: true
    });
    document.dispatchEvent(event);
    return true;
  },

  // Form helpers
  fillForm(formSelector, values) {
    const form = document.querySelector(formSelector);
    if (!form) throw new Error(\`Form not found: \${formSelector}\`);

    for (const [name, value] of Object.entries(values)) {
      const input = form.querySelector(\`[name="\${name}"]\`) ||
                    form.querySelector(\`#\${name}\`);
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return true;
  },

  // Submit form
  submitForm(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) throw new Error(\`Form not found: \${formSelector}\`);
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    return true;
  },

  // Local storage helpers
  setLocalStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  getLocalStorage(key) {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  },

  // Session storage helpers
  setSessionStorage(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  },

  getSessionStorage(key) {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  }
};
`;

/**
 * Create a fully wrapped test that can be executed
 */
export function createExecutableTest(test: TestCase): string {
  const wrappedCode = `
${assertions}
${testHelpers}

(async () => {
  const testStart = Date.now();
  try {
    const result = await (async () => {
      ${test.code}
    })();
    return {
      name: ${JSON.stringify(test.name)},
      passed: true,
      result,
      duration: Date.now() - testStart
    };
  } catch (error) {
    return {
      name: ${JSON.stringify(test.name)},
      passed: false,
      error: error.message || String(error),
      stack: error.stack,
      duration: Date.now() - testStart
    };
  }
})();
`;
  return wrappedCode;
}

/**
 * Generate test report from results
 */
export function generateReport(results: TestResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  let report = `
╔══════════════════════════════════════════════════════════════╗
║                    E2E TEST REPORT                           ║
╠══════════════════════════════════════════════════════════════╣
║  Total: ${total.toString().padEnd(6)} Passed: ${passed.toString().padEnd(6)} Failed: ${failed.toString().padEnd(6)}        ║
║  Duration: ${(totalDuration / 1000).toFixed(2)}s                                        ║
║  Pass Rate: ${((passed / total) * 100).toFixed(1)}%                                       ║
╚══════════════════════════════════════════════════════════════╝

`;

  // Group by category
  const byCategory = results.reduce(
    (acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push(r);
      return acc;
    },
    {} as Record<string, TestResult[]>
  );

  for (const [category, tests] of Object.entries(byCategory)) {
    const catPassed = tests.filter((t) => t.passed).length;
    report += `\n## ${category} (${catPassed}/${tests.length})\n\n`;

    for (const test of tests) {
      const icon = test.passed ? "✅" : "❌";
      const duration = `${test.duration}ms`;
      report += `${icon} ${test.name} (${duration})`;
      if (!test.passed && test.error) {
        report += `\n   Error: ${test.error}`;
      }
      report += "\n";
    }
  }

  return report;
}
