/**
 * Test script to verify model picker search focus issue is fixed
 * This script can be run in the browser console when the app is open
 */

// Test the model picker search functionality
async function testModelPickerFocus() {
  console.log('Testing model picker search focus...');
  
  // Wait for the app to load
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Navigate to settings
  const settingsButton = document.querySelector('[href="/settings"]');
  if (settingsButton) {
    settingsButton.click();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Navigate to providers tab
  const providersTab = document.querySelector('[href="/settings/providers"]');
  if (providersTab) {
    providersTab.click();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Find a model selector
  const modelSelectors = document.querySelectorAll('[role="combobox"]');
  if (modelSelectors.length > 0) {
    const firstSelector = modelSelectors[0];
    firstSelector.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Find search input
    const searchInput = document.querySelector('input[placeholder="Search models..."]');
    if (searchInput) {
      console.log('Search input found, testing focus retention...');
      
      // Test typing multiple characters
      const testString = 'gpt-4-turbo';
      let focusLost = false;
      
      for (let i = 0; i < testString.length; i++) {
        searchInput.focus();
        searchInput.value += testString[i];
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (document.activeElement !== searchInput) {
          console.log(`Focus lost after character ${i + 1}: "${testString[i]}"`);
          focusLost = true;
          break;
        }
      }
      
      if (!focusLost) {
        console.log('✅ SUCCESS: Search input maintained focus for all characters');
        console.log(`Successfully typed "${testString}" without losing focus`);
      } else {
        console.log('❌ FAILURE: Search input lost focus during typing');
      }
    } else {
      console.log('❌ Search input not found');
    }
  } else {
    console.log('❌ Model selectors not found');
  }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  window.testModelPickerFocus = testModelPickerFocus;
}
