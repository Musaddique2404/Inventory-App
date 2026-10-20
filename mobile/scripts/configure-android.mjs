// Tweaks the generated Android project before it is built.
// Runs in CI after `npx cap add android` (the android/ folder is not committed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const versionCode = parseInt(process.env.VERSION_CODE || '1', 10);
const versionName = process.env.VERSION_NAME || '1.0.0';

function edit(path, fn) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) console.warn(`(no change) ${path}`);
  writeFileSync(path, after);
  console.log(`updated ${path}`);
}

// 1) Version number shown in Android settings / required for updates
edit('android/app/build.gradle', s => s
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${versionName}"`));

// 2) Optional release signing (only when the keystore secrets are provided)
if (process.env.ANDROID_KEYSTORE_FILE) {
  edit('android/app/build.gradle', s => s.replace(
    /buildTypes \{/,
    `signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {`).replace(
    /release \{\n(\s*)minifyEnabled false/,
    `release {\n$1signingConfig signingConfigs.release\n$1minifyEnabled false`));
}

// 3) Ateer is a phone app: keep it in portrait
edit('android/app/src/main/AndroidManifest.xml', s =>
  s.includes('android:screenOrientation') ? s
    : s.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"'));

// 4) Brand colours for the system UI on older Android versions
edit('android/app/src/main/res/values/styles.xml', s => s
  .replace('<item name="colorPrimary">@color/colorPrimary</item>', '<item name="colorPrimary">#E8710A</item>')
  .replace('<item name="colorPrimaryDark">@color/colorPrimaryDark</item>', '<item name="colorPrimaryDark">#F4F2EF</item>')
  .replace('<item name="colorAccent">@color/colorAccent</item>', '<item name="colorAccent">#E8710A</item>'));

console.log(`Ateer Android ${versionName} (${versionCode}) configured`);
