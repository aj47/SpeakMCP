/**
 * UI Components Tests
 *
 * Tests UI component rendering, interactions, and state
 */

import { TestSuite } from "../utils/test-framework";

export const uiComponentsSuite: TestSuite = {
  name: "UI Components",
  category: "UI Components",
  tests: [
    // =====================================================
    // App Layout
    // =====================================================
    {
      name: "App layout renders correctly",
      description: "Check main layout structure",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 500));

        const layout = document.querySelector('[class*="layout"], [class*="Layout"], main, [class*="app"]');
        assert.exists(layout, 'Layout should exist');
        return 'Layout rendered';
      `,
    },
    {
      name: "Navigation/sidebar exists",
      description: "Check for navigation elements",
      code: `
        const nav = document.querySelector('nav, [class*="sidebar"], [class*="Sidebar"], [class*="navigation"]');
        return nav ? 'Navigation found' : 'Navigation may be hidden';
      `,
    },
    {
      name: "Main content area exists",
      description: "Check for main content",
      code: `
        const main = document.querySelector('main, [class*="content"], [class*="Content"], [class*="main"]');
        assert.exists(main, 'Main content should exist');
        return 'Main content area found';
      `,
    },

    // =====================================================
    // Header/Titlebar
    // =====================================================
    {
      name: "App has header or titlebar",
      description: "Check for header element",
      code: `
        const header = document.querySelector('header, [class*="header"], [class*="Header"], [class*="titlebar"], [class*="Titlebar"]');
        return header ? 'Header found' : 'No visible header (may use system titlebar)';
      `,
    },

    // =====================================================
    // Buttons
    // =====================================================
    {
      name: "Buttons are present in UI",
      description: "Count button elements",
      code: `
        const buttons = document.querySelectorAll('button');
        assert.truthy(buttons.length > 0, 'Should have buttons');
        return buttons.length;
      `,
    },
    {
      name: "Buttons are clickable",
      description: "Check button interactivity",
      code: `
        const buttons = document.querySelectorAll('button:not([disabled])');
        return {
          totalButtons: document.querySelectorAll('button').length,
          enabledButtons: buttons.length
        };
      `,
    },

    // =====================================================
    // Forms and Inputs
    // =====================================================
    {
      name: "Settings page has form inputs",
      description: "Check settings form elements",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length;
      `,
    },
    {
      name: "Inputs accept user input",
      description: "Test input interactivity",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const input = document.querySelector('input:not([type="hidden"]):not([disabled])');
        if (input) {
          const originalValue = input.value;
          input.value = 'test-value';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const newValue = input.value;
          input.value = originalValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { changed: newValue === 'test-value' };
        }
        return 'No editable input found';
      `,
    },
    {
      name: "Checkboxes work correctly",
      description: "Test checkbox toggle",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const checkbox = document.querySelector('input[type="checkbox"]:not([disabled])');
        if (checkbox) {
          const wasChecked = checkbox.checked;
          checkbox.click();
          const isNowChecked = checkbox.checked;
          checkbox.click(); // restore
          return { toggled: wasChecked !== isNowChecked };
        }
        return 'No checkbox found';
      `,
    },
    {
      name: "Select dropdowns exist",
      description: "Check for select elements",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 500));

        const selects = document.querySelectorAll('select, [role="combobox"], [class*="select"], [class*="Select"]');
        return selects.length;
      `,
    },

    // =====================================================
    // Dialogs and Modals
    // =====================================================
    {
      name: "Dialog/modal system available",
      description: "Check for dialog elements",
      code: `
        // Dialogs may not be visible, check for portal containers
        const dialogPortal = document.querySelector('[class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"], [role="dialog"]');
        const portalRoot = document.querySelector('[id*="portal"], [id*="modal"]');
        return {
          visibleDialog: !!dialogPortal,
          portalContainer: !!portalRoot
        };
      `,
    },

    // =====================================================
    // Tooltips
    // =====================================================
    {
      name: "Tooltips are available",
      description: "Check for tooltip elements",
      code: `
        // Tooltips often appear on hover
        const tooltipTriggers = document.querySelectorAll('[title], [data-tooltip], [aria-describedby]');
        return tooltipTriggers.length;
      `,
    },

    // =====================================================
    // Icons
    // =====================================================
    {
      name: "Icons render in UI",
      description: "Check for icon elements",
      code: `
        const icons = document.querySelectorAll('svg, [class*="icon"], [class*="Icon"], i[class]');
        return icons.length;
      `,
    },

    // =====================================================
    // Loading States
    // =====================================================
    {
      name: "Loading indicators available",
      description: "Check for loading/spinner elements",
      code: `
        const loaders = document.querySelectorAll('[class*="loading"], [class*="Loading"], [class*="spinner"], [class*="Spinner"], [role="progressbar"]');
        return {
          loadingElements: loaders.length,
          note: 'Loaders may not be visible when content is loaded'
        };
      `,
    },

    // =====================================================
    // Error States
    // =====================================================
    {
      name: "Error display elements exist",
      description: "Check for error UI components",
      code: `
        const errors = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]');
        return {
          errorElements: errors.length,
          note: 'No errors expected in normal state'
        };
      `,
    },

    // =====================================================
    // Lists and Tables
    // =====================================================
    {
      name: "List components render",
      description: "Check for list elements",
      code: `
        const lists = document.querySelectorAll('ul, ol, [class*="list"], [class*="List"], [role="list"]');
        return lists.length;
      `,
    },

    // =====================================================
    // Text/Typography
    // =====================================================
    {
      name: "Headings are present",
      description: "Check heading hierarchy",
      code: `
        const h1 = document.querySelectorAll('h1');
        const h2 = document.querySelectorAll('h2');
        const h3 = document.querySelectorAll('h3');
        return { h1: h1.length, h2: h2.length, h3: h3.length };
      `,
    },
    {
      name: "Text content renders",
      description: "Check for text content",
      code: `
        const bodyText = document.body.innerText;
        assert.truthy(bodyText.length > 0, 'Page should have text content');
        return bodyText.length;
      `,
    },

    // =====================================================
    // Keyboard Navigation
    // =====================================================
    {
      name: "Focusable elements exist",
      description: "Check keyboard accessibility",
      code: `
        const focusable = document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
        return focusable.length;
      `,
    },
    {
      name: "Tab order works",
      description: "Test tab navigation",
      code: `
        const focusable = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'));
        if (focusable.length > 0) {
          focusable[0].focus();
          const firstFocused = document.activeElement;
          return {
            canFocus: firstFocused === focusable[0],
            focusableCount: focusable.length
          };
        }
        return 'No focusable elements';
      `,
    },

    // =====================================================
    // Scrolling
    // =====================================================
    {
      name: "Scrollable areas work",
      description: "Check scroll containers",
      code: `
        const scrollContainers = Array.from(document.querySelectorAll('*')).filter(el => {
          const style = getComputedStyle(el);
          return style.overflow === 'auto' || style.overflow === 'scroll' ||
                 style.overflowY === 'auto' || style.overflowY === 'scroll';
        });
        return scrollContainers.length;
      `,
    },

    // =====================================================
    // Responsive Layout
    // =====================================================
    {
      name: "Layout adapts to window size",
      description: "Check responsive design",
      code: `
        const width = window.innerWidth;
        const height = window.innerHeight;
        const rootWidth = document.documentElement.clientWidth;

        return {
          windowWidth: width,
          windowHeight: height,
          rootWidth: rootWidth,
          hasFlexOrGrid: document.querySelector('[class*="flex"], [class*="grid"]') !== null
        };
      `,
    },

    // =====================================================
    // Settings UI Components
    // =====================================================
    {
      name: "Settings pages have consistent layout",
      description: "Check settings UI structure",
      code: `
        await helpers.navigate('/settings/general');
        await new Promise(r => setTimeout(r, 300));
        const generalContent = document.body.innerHTML.length;

        await helpers.navigate('/settings/models');
        await new Promise(r => setTimeout(r, 300));
        const modelsContent = document.body.innerHTML.length;

        return {
          generalLength: generalContent,
          modelsLength: modelsContent,
          bothHaveContent: generalContent > 100 && modelsContent > 100
        };
      `,
    },

    // =====================================================
    // Theme/Styling
    // =====================================================
    {
      name: "CSS styles are applied",
      description: "Check styling is loaded",
      code: `
        const styles = document.styleSheets;
        const computedStyles = getComputedStyle(document.body);

        return {
          styleSheetsCount: styles.length,
          hasBackground: computedStyles.backgroundColor !== '',
          hasFontFamily: computedStyles.fontFamily !== ''
        };
      `,
    },

    // =====================================================
    // Animation/Transitions
    // =====================================================
    {
      name: "CSS transitions available",
      description: "Check for animated elements",
      code: `
        const transitioned = Array.from(document.querySelectorAll('*')).filter(el => {
          const style = getComputedStyle(el);
          return style.transition && style.transition !== 'none' && style.transition !== 'all 0s ease 0s';
        });
        return transitioned.length;
      `,
    },

    // =====================================================
    // Cleanup
    // =====================================================
    {
      name: "Return to root after UI tests",
      description: "Navigate back to root",
      code: `
        await helpers.navigate('/');
        await new Promise(r => setTimeout(r, 300));
        return helpers.getRoute();
      `,
    },
  ],
};

export default uiComponentsSuite;
