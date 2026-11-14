# Mobile companion (iOS and Android)

A simplified, read-only companion to the web dashboard. It shows what needs attention:

- **Issues**: open findings, most severe first.
- **Groups**: each group with its open-issue count, worst severity, and member monitors.

Approving or rejecting actions stays on the web dashboard, where the approval is audited in the same place.

## How it signs in

The apps use the server's own sign-in, not a separate login:

1. The app opens `/auth/login` in a web view. Microsoft Entra (or easy-auth, depending on the server) handles the sign-in.
2. After the callback, the server sets the session cookie (`im_session`, or `__Host-im_session` over https). The app reads that cookie and keeps it in the Keychain (iOS) or EncryptedSharedPreferences (Android).
3. API calls send the cookie. A `401` means the session expired; the app shows the sign-in screen again.

The server's rules still apply: sessions are idle-limited to 30 minutes and absolute-limited to 12 hours, and the mobile app has no extra access.

## Configure the server address

- iOS: `ios/IntegrationMonitor/Config.swift`, `baseURL`.
- Android: `android/app/build.gradle.kts`, `BASE_URL`.

Use the https address of the deployed server. Plain http works only on a local network for testing, and the cookie then has no `Secure` flag.

## iOS (Swift, SwiftUI)

Requires Xcode 16 or later and iOS 17 or later.

```bash
brew install xcodegen
cd mobile/ios
xcodegen generate
open IntegrationMonitor.xcodeproj
```

Choose a team under Signing, set `baseURL`, and run.

## Android (Kotlin, Jetpack Compose)

Requires Android Studio (Koala or later), JDK 17, and minSdk 26.

Open `mobile/android` in Android Studio, set `BASE_URL` in `app/build.gradle.kts`, and run the `app` configuration.

## Status

Both projects are written against the API in `src/http/contracts.ts`. They have not been compiled or run on a device: the build machine used to write them had no Swift toolchain and no Android SDK. Before relying on them, check:

- the sign-in cookie is captured on a real device (Android's cookie manager may hide HttpOnly cookies on some versions; if so, switch to the fallback noted in `SessionStore.kt`);
- the apps load issues and groups against a deployed server.
