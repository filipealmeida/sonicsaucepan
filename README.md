# Sonic Saucepan

Sonic Saucepan is a cross-platform (iOS, Android, Web) audio application that allows users to visually build chord progression loops using a graph-based state machine. It requires zero musical background, acting as a sandbox for sonic exploration.

## Frontend Build And Deploy Commands

All frontend commands run from the `frontend` directory.

### Install dependencies

```bash
cd frontend
npm install
```

### Web target

- Start local development server:

```bash
npm run dev
```

- Create production web build:

```bash
npm run build
```

- Preview the production web build locally:

```bash
npm run preview
```

### Android target

- Build web assets and sync into Capacitor Android project:

```bash
npm run android:sync
```

- Open Android project in Android Studio:

```bash
npm run android:open
```

- Build debug APK:

```bash
npm run android:apk:debug
```

- Build release APK:

```bash
npm run android:apk:release
```

- Build release Android App Bundle (distribution target for Play Store):

```bash
npm run android:bundle:release
```

- Build debug APK, install on first authorized USB Android device, and launch app:

```bash
npm run android:install:usb
```

### iOS target

- iOS project generation and deploy scripts are not configured in this repository yet.

## Frontend Functionality And UI Usage

### What the frontend does

- Provides an interactive visual interface for creating and editing looping chord progressions.
- Plays audio in-app via Web Audio.
- Supports MIDI output routing when enabled and available.
- Saves session state and user settings locally.

### How to use the interface

- Tap the top-left label to toggle displayed chord format between numerals and chord names.
- Long press Play to open perform actions.
- Long press a node to open node-specific playback and timing options.
- Pinch to zoom the scene.
- Drag on the stage to pan.
- Use the settings panel to configure central tone, timing, sound, and MIDI output.

