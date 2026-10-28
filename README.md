# Roblok — Android prototip (v0.2)

Katta xarita (160x160), Registon, Shahar, Labirint, Tog', Ko'l, O'rmon, 3 xil obby yo'li,
dushmanlar (shilimshiq, qora ritsar, Labirint qo'riqchisi), qilich, mini-xarita, tez o'tish, ovozlar.

## Tuzilishi
- `web/src/main.js` — o'yin (Three.js), `web/src/index.html` — interfeys
- `web/build.sh` — esbuild bilan `web/dist/game.js` ga yig'adi
- `android/` — WebView ilova (Java), `android/build-apk.sh` — APK yig'ish

## APK yig'ish (Ubuntu)
    sudo apt install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner openjdk-17-jdk nodejs npm
    (cd web && npm install)
    ./android/build-apk.sh        # natija: android/build/Roblok.apk

APK debug kalit bilan imzolangan (`roblok-debug.keystore`, parol `android`).
Play Market uchun alohida release kalit kerak.
