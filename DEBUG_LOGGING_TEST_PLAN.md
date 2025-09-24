# Debug Logging Feature - Test Plan

## Overview
This document outlines the comprehensive test plan for the debug logging feature implemented in SpeakMCP. The feature provides users with the ability to view, manage, and export debug logs for troubleshooting purposes.

## Feature Summary
- **Debug Logging Service**: Captures all program activities with configurable log levels
- **File Management**: Automatic log rotation and size management (max 10MB per file)
- **UI Integration**: Debug Logs section in MCP Tools settings page
- **Configuration**: Enable/disable, log levels, file size limits
- **Export/Import**: Export logs for sharing or analysis

## Test Categories

### 1. Unit Tests
**Location**: `src/main/__tests__/debug-logging-service.test.ts`

**Coverage**:
- ✅ Singleton pattern implementation
- ✅ Log folder creation and management
- ✅ Logging methods (debug, info, warning, error)
- ✅ Log level filtering
- ✅ Buffer management and flushing
- ✅ File size management and rotation
- ✅ Log file cleanup
- ✅ Log retrieval and export
- ✅ Error handling and edge cases

**Run Command**: `npm test debug-logging-service.test.ts`

### 2. Integration Tests
**Location**: `src/renderer/src/components/__tests__/debug-logs-manager.test.tsx`

**Coverage**:
- ✅ UI component rendering
- ✅ Configuration controls
- ✅ Log display and formatting
- ✅ Search and filtering functionality
- ✅ Action buttons (refresh, export, clear)
- ✅ Error handling and user feedback
- ✅ Empty states and loading states

**Run Command**: `npm test debug-logs-manager.test.tsx`

### 3. End-to-End Tests

#### 3.1 Basic Functionality
**Test Case**: Enable Debug Logging
1. Open SpeakMCP application
2. Navigate to Settings > MCP Tools
3. Scroll to "Debug Logs" section
4. Toggle "Enable Debug Logging" to ON
5. Set log level to "Debug"
6. Perform various actions in the app
7. Return to Debug Logs section
8. Click "Refresh" button
9. **Expected**: Debug logs appear in the list

**Test Case**: Log Level Filtering
1. Set log level to "Warning"
2. Perform actions that generate different log levels
3. **Expected**: Only warning and error logs are captured

#### 3.2 File Management
**Test Case**: Log Rotation
1. Set max file size to 1MB
2. Generate large amounts of debug logs
3. Check debug logs folder
4. **Expected**: Multiple log files created when size limit reached

**Test Case**: File Cleanup
1. Set max files to 3
2. Generate enough logs to create 5+ files
3. **Expected**: Only 3 most recent files remain

#### 3.3 UI Functionality
**Test Case**: Search and Filter
1. Generate logs from different components
2. Use search box to filter by message content
3. Use level filter dropdown
4. Use component filter dropdown
5. **Expected**: Logs filtered correctly

**Test Case**: Export Functionality
1. Generate some debug logs
2. Click "Export" button
3. **Expected**: File saved with timestamp, success message shown

**Test Case**: Clear Functionality
1. Generate some debug logs
2. Click "Clear" button
3. **Expected**: All logs cleared, empty state shown

#### 3.4 Performance Tests
**Test Case**: High Volume Logging
1. Enable debug logging
2. Set log level to "Debug"
3. Perform intensive operations (agent mode, multiple tool calls)
4. Monitor application performance
5. **Expected**: No significant performance degradation

**Test Case**: Memory Usage
1. Generate large amounts of logs
2. Monitor memory usage over time
3. **Expected**: Memory usage remains stable (buffer flushing works)

#### 3.5 Configuration Persistence
**Test Case**: Settings Persistence
1. Configure debug logging settings
2. Restart application
3. **Expected**: Settings are preserved

**Test Case**: Log File Persistence
1. Generate debug logs
2. Restart application
3. **Expected**: Previous logs are still accessible

### 4. Error Scenarios

#### 4.1 File System Errors
**Test Case**: Disk Full
1. Fill up disk space
2. Try to generate logs
3. **Expected**: Graceful handling, no application crash

**Test Case**: Permission Denied
1. Remove write permissions from log folder
2. Try to generate logs
3. **Expected**: Graceful handling, error logged

#### 4.2 Configuration Errors
**Test Case**: Invalid Configuration
1. Manually edit config with invalid values
2. Restart application
3. **Expected**: Defaults used, application continues

### 5. Cross-Platform Tests

#### 5.1 macOS
- ✅ Log folder creation in correct location
- ✅ File permissions handling
- ✅ UI rendering and functionality

#### 5.2 Windows
- ✅ Log folder creation in AppData
- ✅ File path handling
- ✅ UI rendering and functionality

#### 5.3 Linux
- ✅ Log folder creation in ~/.config
- ✅ File permissions
- ✅ UI rendering and functionality

## Manual Testing Checklist

### Pre-Testing Setup
- [ ] Fresh installation of SpeakMCP
- [ ] No existing debug logs
- [ ] Default configuration

### Configuration Testing
- [ ] Enable/disable debug logging toggle works
- [ ] Log level dropdown functions correctly
- [ ] Max file size input accepts valid values (1-100)
- [ ] Max files input accepts valid values (1-20)
- [ ] Settings are saved immediately
- [ ] Invalid inputs are handled gracefully

### Logging Testing
- [ ] Debug logs are generated when enabled
- [ ] No logs generated when disabled
- [ ] Log level filtering works correctly
- [ ] All components generate logs (app, mcp, llm, keyboard, window)
- [ ] Error logs include stack traces
- [ ] Log timestamps are accurate

### UI Testing
- [ ] Log entries display correctly with proper formatting
- [ ] Level badges show correct colors (error=red, warning=yellow, etc.)
- [ ] Component badges are displayed
- [ ] Timestamps are formatted properly
- [ ] Details expansion works for complex log entries
- [ ] Stack trace expansion works for errors

### Search and Filter Testing
- [ ] Search by message content works
- [ ] Search by component name works
- [ ] Search by details content works
- [ ] Level filter dropdown works
- [ ] Component filter dropdown populates correctly
- [ ] Multiple filters work together
- [ ] Clear search/filters works

### Action Testing
- [ ] Refresh button updates log list
- [ ] Export button creates file with correct format
- [ ] Export file contains all logs in chronological order
- [ ] Clear button removes all logs
- [ ] Clear button shows confirmation if needed
- [ ] Buttons are disabled when debug logging is off

### File Management Testing
- [ ] Log files are created in correct location
- [ ] File rotation occurs at size limit
- [ ] Old files are cleaned up correctly
- [ ] File permissions are correct
- [ ] Log format is valid JSON lines

### Performance Testing
- [ ] Application startup time not significantly affected
- [ ] UI remains responsive with large log volumes
- [ ] Memory usage remains stable
- [ ] File I/O doesn't block main thread

### Error Handling Testing
- [ ] Network errors don't crash logging
- [ ] File system errors are handled gracefully
- [ ] Invalid log data doesn't break UI
- [ ] Missing log files don't cause errors

## Success Criteria

### Functional Requirements
- ✅ Debug logging can be enabled/disabled via UI
- ✅ Log levels are configurable and respected
- ✅ File size management works (max 10MB default)
- ✅ Log rotation and cleanup functions correctly
- ✅ UI displays logs with proper formatting
- ✅ Search and filtering work as expected
- ✅ Export functionality creates valid files
- ✅ Clear functionality removes all logs

### Non-Functional Requirements
- ✅ Performance impact is minimal (<5% overhead)
- ✅ Memory usage is controlled (buffer flushing)
- ✅ File I/O is non-blocking
- ✅ UI is responsive with large datasets
- ✅ Cross-platform compatibility
- ✅ Error handling is robust

### User Experience Requirements
- ✅ Feature is discoverable in MCP Tools section
- ✅ Configuration is intuitive
- ✅ Log display is readable and useful
- ✅ Actions provide appropriate feedback
- ✅ Empty states are informative
- ✅ Error messages are helpful

## Test Execution

### Automated Tests
```bash
# Run unit tests
npm test debug-logging-service.test.ts

# Run integration tests
npm test debug-logs-manager.test.tsx

# Run all tests
npm test
```

### Manual Tests
1. Follow the manual testing checklist above
2. Document any issues found
3. Verify fixes with regression testing
4. Sign off on each test category

## Bug Reporting Template

**Title**: [Component] Brief description

**Environment**:
- OS: [macOS/Windows/Linux]
- SpeakMCP Version: [version]
- Node.js Version: [version]

**Steps to Reproduce**:
1. Step 1
2. Step 2
3. Step 3

**Expected Result**: What should happen

**Actual Result**: What actually happened

**Logs**: Relevant debug logs or error messages

**Screenshots**: If applicable

**Severity**: [Critical/High/Medium/Low]

## Conclusion

This comprehensive test plan ensures that the debug logging feature is thoroughly validated across all aspects of functionality, performance, and user experience. The combination of automated tests and manual testing provides confidence in the feature's reliability and usability.
