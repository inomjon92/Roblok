#!/bin/sh
# Builds Roblok.apk with the Debian/Ubuntu Android SDK packages
# (apt install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner).
set -e
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk
ANDROID_JAR=$SDK/platforms/android-23/android.jar
OUT=build
rm -rf $OUT && mkdir -p $OUT/classes $OUT/assets

(cd ../web && ./build.sh)
cp ../web/dist/index.html ../web/dist/game.js ../web/dist/update.js $OUT/assets/

javac --release 8 -nowarn -cp "$ANDROID_JAR" -d $OUT/classes src/uz/roblok/game/*.java
dalvik-exchange --dex --output=$OUT/classes.dex $OUT/classes

# -0 arsc keeps resources.arsc uncompressed, required for targetSdk 30+
aapt package -f -M AndroidManifest.xml -S res -A $OUT/assets -I "$ANDROID_JAR" \
  -0 arsc -F $OUT/unaligned.apk
(cd $OUT && aapt add unaligned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unaligned.apk $OUT/aligned.apk

KEYSTORE=${KEYSTORE:-roblok-debug.keystore}
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias roblok \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Roblok Debug,O=Roblok,C=UZ" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 23 --out $OUT/Roblok.apk $OUT/aligned.apk
apksigner verify --print-certs $OUT/Roblok.apk | head -1
ls -la $OUT/Roblok.apk
