# Qleck → TestFlight (MacBook runbook)

Everything below runs on the MacBook. Commands are paste-safe (no `&&`, one
block per step). Dev happens on Windows; the Mac only builds and uploads.

## 0. One-time, in the browser (App Store Connect)

1. https://developer.apple.com/account → Certificates, Identifiers & Profiles
   → Identifiers → **+** → App ID → App.
   - Bundle ID (explicit): `com.qleck.app`
   - Capabilities: tick **Sign In with Apple**.
2. https://appstoreconnect.apple.com → My Apps → **+** → New App.
   - Platform iOS · Name **Qleck** · Language English · Bundle ID
     `com.qleck.app` · SKU `qleck-001`.

(If Xcode's automatic signing offers to register the App ID for you in step 2
of the build, that also works — the App Store Connect app record is the part
that must exist before an upload.)

## 1. Get the code

```
cd ~/Desktop
git clone https://github.com/GoalLearner/qleck.git
cd qleck
npm ci
```

(Already cloned? `cd ~/Desktop/qleck` then `git pull` then `npm ci`.)

## 2. Generate the native project

```
npx expo prebuild -p ios
```

This writes the `ios/` folder (gitignored — it is disposable, regenerate any
time) and injects the Sign in with Apple entitlement from app.json.

```
npx pod-install
```

## 3. Open in Xcode and sign

```
open ios/Qleck.xcworkspace
```

In Xcode:
1. Click the **Qleck** project → target **Qleck** → **Signing & Capabilities**.
2. Team: select the developer team. Leave "Automatically manage signing" on.
3. Confirm the **Sign In with Apple** capability is listed (prebuild adds it;
   if missing, click **+ Capability** and add it).
4. Top bar device selector: choose **Any iOS Device (arm64)**.

## 4. Archive and upload

1. Menu **Product → Archive** (few minutes).
2. The Organizer opens → **Distribute App** → **TestFlight & App Store** →
   **Upload** → accept defaults → Upload.
3. Processing takes ~5–15 min (email arrives when done).

## 5. TestFlight

In App Store Connect → Qleck → TestFlight:
1. The build appears under iOS builds. Answer the export-compliance question
   (uses standard encryption only → **None of the above / standard**).
2. **Internal Testing** → create a group → add your Apple ID (and partner's)
   → assign the build. Internal testers get it in minutes, no review.
3. External testers later: add a group + a short beta description → Apple's
   beta review (~1 day).

## 6. First-device test script (the part only a real device can prove)

1. Fresh install → complete onboarding **without** signing in? Not possible on
   iOS — the door IS Sign in with Apple. Tap it, complete profile + first
   goal. Confirm the goal exists.
2. Settings → You tab → Log out → confirm the copy says goals are recoverable
   → Sign in with Apple again → **goals come back**.
3. Delete the app entirely → reinstall from TestFlight → Sign in with Apple →
   goals come back (reinstall path).
4. Anything failing here: screenshot + the approximate time, and report back —
   the server logs failures with reasons now.

## Ship-again loop (every later build)

```
cd ~/Desktop/qleck
git pull
npm ci
npx expo prebuild -p ios --clean
npx pod-install
open ios/Qleck.xcworkspace
```

Then bump **Build** number in Xcode (or ask for `ios.buildNumber` to be bumped
in app.json before pulling), Archive, Upload, assign in TestFlight.
