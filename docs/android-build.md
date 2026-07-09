# Android App Build

The Render deployment is the hosted web app. For a downloadable Android app, this project uses Capacitor to wrap the React app in a native Android project.

## Build A Test APK

Run this from the project root:

```bash
npm install
npm run android:apk
```

On Windows PowerShell, use `npm.cmd` if `npm` is blocked:

```powershell
npm.cmd install
npm.cmd run android:apk
```

The debug APK is created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

This file can be installed directly on an Android phone for testing. Because it is a debug build, Android may ask you to allow installs from unknown apps.

## Build For Google Play

For Play Store submission, build an Android App Bundle instead:

```bash
npm run android:bundle
```

The release bundle is created under:

```text
android/app/build/outputs/bundle/release/
```

A real Play Store release also needs signing keys, app icons, screenshots, privacy policy details, and a Google Play developer account.

## iPhone Note

iPhones cannot install a downloaded APK. For iOS, the practical routes are:

- Use the existing PWA from Safari with Share > Add to Home Screen.
- Create an iOS Capacitor project on a Mac with Xcode.
- Distribute a native iOS app through TestFlight or the App Store using an Apple Developer account.
