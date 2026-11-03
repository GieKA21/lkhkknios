/**
 * Salinan berkas yang TIDAK bisa ditangani patch-package.
 *
 * react-native-vision-camera memuat berkas Kotlin ter-generate dengan nama
 * sangat panjang; di Windows git gagal membacanya ("Filename too long"),
 * sehingga patch-package tidak dapat membuat diff untuk paket itu sama sekali.
 * Berkas di patches/manual/ karena itu disalin langsung setelah npm install.
 */
const fs = require("fs");
const path = require("path");

const SALINAN = [
  {
    dari: "patches/manual/react-native-vision-camera__ViewGroup+installHierarchyFitter.kt",
    ke: "node_modules/react-native-vision-camera/android/src/main/java/com/margelo/nitro/camera/extensions/ViewGroup+installHierarchyFitter.kt",
  },
];

for (const { dari, ke } of SALINAN) {
  const sumber = path.resolve(__dirname, "..", dari);
  const tujuan = path.resolve(__dirname, "..", ke);
  if (!fs.existsSync(sumber)) {
    console.warn(`[manual-patch] lewati, sumber tidak ada: ${dari}`);
    continue;
  }
  if (!fs.existsSync(path.dirname(tujuan))) {
    console.warn(`[manual-patch] lewati, paket belum terpasang: ${ke}`);
    continue;
  }
  fs.copyFileSync(sumber, tujuan);
  console.log(`[manual-patch] diterapkan: ${path.basename(ke)}`);
}
