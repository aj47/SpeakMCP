# OpenAI Chat Mobile

A React Native (Expo) mobile interface with voice interaction for OpenAI-compatible APIs — chat with AI models wherever you are, even hands‑free in the car. Quickly configure your API endpoint and model, then chat by text or voice with real‑time transcription and optional text‑to‑speech playback.

## Features

- Chat with any Inkeep Agent from your tenant
- Voice input two ways:
  - Press‑and‑hold mic for real‑time transcription; release to send (or release in edit mode to keep the text in the input)
  - Hands‑free mode (VAD-backed) to toggle listening without holding the button
- Assistant responses can be spoken aloud using text‑to‑speech (expo-speech)
- Local vs Cloud environment toggle with separate Manage API and Run API base URLs
- Persisted settings (API key, IDs, URLs, voice prefs) via AsyncStorage
- Clean, readable UI with safe area support and basic theming
- Web fallback for speech recognition when available (Chrome/Edge over HTTPS)

## Architecture

- Expo SDK 54, React Native 0.81, React 19
- Navigation: @react-navigation/native + native-stack
- Speech recognition: expo-speech-recognition (native); Web Speech API fallback in browsers
- Speech synthesis: expo-speech
- Persistent config: AsyncStorage
- OpenAI-compatible API integration
  - Chat completions endpoint with optional streaming token updates

Key files:
- App.tsx: Navigation and providers
- src/store/config.ts: Config shape, persistence
- src/lib/openaiClient.ts: OpenAI-compatible API client with streaming parsing
- src/screens/SettingsScreen.tsx: Configure API key, base URL, model, hands‑free toggle
- src/screens/ChatScreen.tsx: Chat UI, voice UX, TTS

## Getting started

Prerequisites:
- Node 18+
- Expo CLI (optional): `npm i -g expo` (you can also use `npx expo`)

Install dependencies:

```bash
npm install
```

Run the app:

```bash
# Start Metro bundler (choose a platform in the UI)
npm run start

# Or run directly on a device/simulator
npm run ios
npm run android
```

Open the app and configure Settings:
- API Key: Your Inkeep API key (Bearer)
- Tenant ID: Your tenant
- Project ID: Your project under the tenant
- Graph ID: Associated graph (if required by your setup)
- Model: Model identifier used by Run API (default: gpt-4o-mini)
- Environment: Toggle Local vs Cloud
  - Run API Base URL (Local/Cloud)
  - Manage API Base URL (Local/Cloud)

After saving, you’ll be taken to the Agents list. Pick an agent to start chatting.

## Voice UX

- Press‑and‑hold mic (when hands‑free is off):
  - Hold to record with live transcription overlay
  - Release to send; or release while in "edit" state to place the transcript into the text box for editing
- Hands‑free mode:
  - Toggle from the Chat screen header (microphone icon)
  - App will listen without needing to hold the button and send on final speech segments
- Assistant replies can be read aloud via text‑to‑speech

Notes:
- On native devices, the app uses expo-speech-recognition; on web, it falls back to the browser’s Web Speech API when available
- Permissions for microphone and speech recognition are requested at runtime (see app.json for iOS `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`; Android uses `RECORD_AUDIO`)

## OpenAI API compatibility

The app works with any OpenAI-compatible API endpoint:
- Chat completions endpoint at `/v1/chat/completions` supporting streaming (SSE or textual chunking)
- The client falls back gracefully when streaming readers aren’t available in React Native
- Compatible with OpenAI, Azure OpenAI, local models (Ollama, LM Studio), and other OpenAI-compatible services

The API key is sent as `Authorization: Bearer <API_KEY>`.

## Screenshots

<img src="./assets/screenshot1.png" width="40%" alt="Screenshot 1" />
<img src="./assets/screenshot2.png" width="40%" alt="Screenshot 2" />


## Important: Development Build Required

This app uses `expo-speech-recognition`, which is a native module **not included in Expo Go**. You must use a **development build** to run the app on Android or iOS devices.

If you see the error:
```
Error: Cannot find native module 'ExpoSpeechRecognition'
```

You need to build and run the native app:

```bash
# For Android
npx expo run:android

# For iOS
npx expo run:ios

# If you have existing native folders and need a clean rebuild
cd android && ./gradlew clean && cd ..
npx expo run:android
```

This will compile the native code with all required modules and install the app on your device/emulator.

## Troubleshooting

- Speech recognition not starting on native / `Cannot find native module 'ExpoSpeechRecognition'`:
  - **You must use a development build** — Expo Go does not support native modules like `expo-speech-recognition`
  - Run `npx expo run:android` or `npx expo run:ios` to build and install the development app
  - See the "Important: Development Build Required" section above
  - Verify microphone/speech permissions are granted
- Web speech not working:
  - Use Chrome or Edge over HTTPS; some browsers or insecure origins disable Web Speech API
- Cannot list agents:
  - Confirm Manage API base URL is reachable and `/health` returns OK
  - Verify tenant/project IDs and API key
- No assistant response:
  - Check Run API base URL and logs; the client supports SSE and non‑SSE responses

## License

MIT
