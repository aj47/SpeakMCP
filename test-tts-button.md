# TTS Button Fix Test Plan

## Issue #139: TTS button in agent progress not working - stays as pause symbol

### Problem Description
The TTS button consistently displays as a pause symbol (⏸️) regardless of its actual state, and clicking it does not toggle to a play symbol (▶️) or trigger the expected TTS functionality.

### Root Cause Analysis
The issue was in the `AudioPlayer` component (`src/renderer/src/components/audio-player.tsx`):

1. **Race condition**: Event listeners were set up based on `hasAudio` dependency, but when new audio data came in, the `src` was set immediately without proper state synchronization.

2. **Missing state reset**: When new audio was loaded, the `isPlaying` state wasn't reset to `false`.

3. **Incomplete dependency array**: The `useEffect` for event listeners didn't include `audioData` in dependencies, causing stale event listeners.

### Fix Implementation

#### Changes Made:

1. **Reset state on new audio load**:
   ```typescript
   // Reset playing state when new audio is loaded
   setIsPlaying(false)
   setCurrentTime(0)
   ```

2. **Improved event listener setup**:
   ```typescript
   // Include audioData to ensure listeners are reset when new audio loads
   }, [hasAudio, audioData])
   ```

3. **Better state synchronization**:
   ```typescript
   // Sync initial state with audio element
   if (audio.src && !audio.paused) {
     setIsPlaying(true)
   } else {
     setIsPlaying(false)
   }
   ```

4. **Enhanced error handling**:
   ```typescript
   const handleError = (event: Event) => {
     console.error("[AudioPlayer] Audio error:", event)
     setIsPlaying(false)
   }
   ```

### Testing Checklist

#### Manual Testing Steps:
1. ✅ **Development server starts successfully** - Confirmed working
2. ⏳ **Navigate to agent progress interface**
3. ⏳ **Trigger TTS generation** (complete an assistant message)
4. ⏳ **Verify initial button state** - Should show play symbol (▶️) when audio is ready but not playing
5. ⏳ **Click play button** - Should change to pause symbol (⏸️) and start audio
6. ⏳ **Click pause button** - Should change back to play symbol (▶️) and pause audio
7. ⏳ **Test audio completion** - Button should return to play symbol when audio ends
8. ⏳ **Test error scenarios** - Button should handle audio errors gracefully

#### Expected Behavior After Fix:
- ✅ When TTS is inactive/stopped: button shows play symbol (▶️)
- ✅ When TTS is active/playing: button shows pause symbol (⏸️)
- ✅ Clicking play starts audio and changes button to pause
- ✅ Clicking pause stops audio and changes button to play
- ✅ Button state synchronizes with actual audio playback state
- ✅ New audio loads reset the button to play state

### Code Changes Summary:
- **File**: `src/renderer/src/components/audio-player.tsx`
- **Lines modified**: ~35 lines in the audio state management logic
- **Key improvements**: 
  - Fixed race condition between audio loading and event listener setup
  - Added proper state reset on new audio
  - Enhanced dependency management in useEffect
  - Improved error handling and logging

### Next Steps:
1. Complete manual testing with the running development server
2. Commit changes to the fix branch
3. Create pull request with detailed description
4. Add `augment_review` label to PR
