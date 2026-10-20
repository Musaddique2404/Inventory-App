# Ateer for Android

This folder turns the Ateer web app into an Android app with [Capacitor](https://capacitorjs.com).
The app opens the live site (`https://musaddique-stockcontrol.vercel.app`), so changes to
`index.html`, `app.js` and `styles.css` reach the app as soon as Vercel deploys them.

## Getting the APK

GitHub builds it for you: see **Actions → Android APK**. Every build is published under
**Releases** as `Ateer-1.0.N.apk` — open that page on your phone, tap the APK and install it.

A new build runs automatically when anything in `mobile/` changes. To build by hand, open
**Actions → Android APK → Run workflow**.

## What's in here

| File | Purpose |
|------|---------|
| `capacitor.config.json` | App id, name, live URL, splash + status bar colours |
| `www/offline.html` | Shown when the phone has no internet |
| `assets/` | Source images for the app icon and splash screen |
| `scripts/configure-android.mjs` | Sets version number, portrait mode and signing |

## Publishing on Google Play (optional)

Builds are debug-signed by default, which is fine for installing on your own phones.
For the Play Store, add these repository secrets (Settings → Secrets and variables → Actions)
and the workflow will also produce a signed `.aab`:

`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
