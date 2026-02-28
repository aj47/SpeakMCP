/**
 * E2E Test Runner
 *
 * This file generates JavaScript code that can be executed via
 * the electron-native MCP's electron_execute function.
 *
 * The generated code runs in the Electron renderer process context
 * with access to:
 * - window.electron.ipcRenderer.invoke() for IPC calls
 * - DOM manipulation
 * - All standard browser APIs
 */

import {
  testSuites,
  createExecutableTest,
  generateReport,
  TestResult,
} from "./index";
import { TestCase, TestSuite } from "./utils/test-framework";

/**
 * Generate executable code for a single test
 */
export function generateTestCode(
  test: TestCase,
  suite: TestSuite
): { name: string; code: string } {
  return {
    name: `${suite.category} > ${test.name}`,
    code: createExecutableTest(test),
  };
}

/**
 * Generate all test code for a suite
 */
export function generateSuiteCode(suiteName: keyof typeof testSuites): string[] {
  const suite = testSuites[suiteName];
  return suite.tests.map((test) => createExecutableTest(test));
}

/**
 * Generate a combined test runner that runs all tests in a suite
 */
export function generateSuiteRunner(suiteName: keyof typeof testSuites): string {
  const suite = testSuites[suiteName];
  const testsJSON = JSON.stringify(
    suite.tests.map((t) => ({
      name: t.name,
      code: t.code,
    }))
  );

  return `
(async () => {
  const assertions = \`${assertionsCode}\`;
  const helpers = \`${helpersCode}\`;

  const tests = ${testsJSON};
  const results = [];

  for (const test of tests) {
    const testStart = Date.now();
    try {
      const fn = new Function(assertions + helpers + 'return (async () => {' + test.code + '})()');
      const result = await fn();
      results.push({
        name: test.name,
        category: ${JSON.stringify(suite.category)},
        passed: true,
        result,
        duration: Date.now() - testStart,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        name: test.name,
        category: ${JSON.stringify(suite.category)},
        passed: false,
        error: error.message || String(error),
        duration: Date.now() - testStart,
        timestamp: new Date().toISOString()
      });
    }
  }

  return {
    suite: ${JSON.stringify(suite.name)},
    category: ${JSON.stringify(suite.category)},
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length
    }
  };
})();
`;
}

// Assertions code (minified for inclusion)
const assertionsCode = `
const assert = {
  equal(a, b, m) { if (a !== b) throw new Error(m || \\\`Expected \\\${JSON.stringify(b)} but got \\\${JSON.stringify(a)}\\\`); },
  deepEqual(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m || 'Deep equality failed'); },
  truthy(v, m) { if (!v) throw new Error(m || \\\`Expected truthy but got \\\${JSON.stringify(v)}\\\`); },
  falsy(v, m) { if (v) throw new Error(m || \\\`Expected falsy but got \\\${JSON.stringify(v)}\\\`); },
  hasProperty(o, p, m) { if (!o || !(p in o)) throw new Error(m || \\\`Missing property "\\\${p}"\\\`); },
  isArray(v, m) { if (!Array.isArray(v)) throw new Error(m || \\\`Expected array but got \\\${typeof v}\\\`); },
  isObject(v, m) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(m || \\\`Expected object but got \\\${typeof v}\\\`); },
  isString(v, m) { if (typeof v !== 'string') throw new Error(m || \\\`Expected string but got \\\${typeof v}\\\`); },
  isNumber(v, m) { if (typeof v !== 'number' || isNaN(v)) throw new Error(m || \\\`Expected number but got \\\${typeof v}\\\`); },
  isBoolean(v, m) { if (typeof v !== 'boolean') throw new Error(m || \\\`Expected boolean but got \\\${typeof v}\\\`); },
  isFunction(v, m) { if (typeof v !== 'function') throw new Error(m || \\\`Expected function but got \\\${typeof v}\\\`); },
  exists(v, m) { if (v === null || v === undefined) throw new Error(m || 'Expected value to exist'); }
};
`;

// Helpers code (minified for inclusion)
const helpersCode = `
const helpers = {
  async waitFor(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(\\\`Timeout after \\\${timeout}ms\\\`);
  },
  async waitForElement(selector, timeout = 5000) {
    return this.waitFor(() => document.querySelector(selector), timeout);
  },
  click(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(\\\`Element not found: \\\${selector}\\\`);
    el.click();
    return true;
  },
  type(selector, value) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(\\\`Input not found: \\\${selector}\\\`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  getText(selector) {
    const el = document.querySelector(selector);
    return el?.textContent || null;
  },
  getAll(selector) {
    return Array.from(document.querySelectorAll(selector));
  },
  async navigate(route) {
    window.location.hash = route;
    await new Promise(r => setTimeout(r, 300));
    return window.location.hash;
  },
  getRoute() {
    return window.location.hash.replace('#', '') || '/';
  },
  async ipc(method, ...args) {
    return window.electron.ipcRenderer.invoke(method, ...args);
  },
  setState(key, value) {
    if (!window.__testState) window.__testState = {};
    window.__testState[key] = value;
  },
  getState(key) {
    return window.__testState?.[key];
  },
  isVisible(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
};
`;

/**
 * Generate a quick single-test runner
 * This is useful for running individual tests via electron_execute
 */
export function generateQuickTest(testCode: string): string {
  return `
(async () => {
  ${assertionsCode}
  ${helpersCode}

  const testStart = Date.now();
  try {
    const result = await (async () => {
      ${testCode}
    })();
    return {
      passed: true,
      result,
      duration: Date.now() - testStart
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message || String(error),
      stack: error.stack,
      duration: Date.now() - testStart
    };
  }
})();
`;
}

/**
 * Print test plan
 */
export function printTestPlan(): void {
  console.log("\n=== SpeakMCP E2E Test Plan ===\n");

  let total = 0;
  for (const [name, suite] of Object.entries(testSuites)) {
    console.log(`${suite.category}: ${suite.name}`);
    console.log(`  Tests: ${suite.tests.length}`);
    suite.tests.forEach((t, i) => {
      console.log(`    ${i + 1}. ${t.name}`);
    });
    total += suite.tests.length;
    console.log();
  }

  console.log(`Total tests: ${total}`);
}

// Export for use
export {
  assertionsCode,
  helpersCode,
};
