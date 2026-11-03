# LKH KKN — Lembar Kerja Harian lintas platform

Aplikasi pencatatan Lembar Kerja Harian Kuliah Kerja Nyata dengan presensi
berbasis verifikasi wajah. Dibangun dengan React Native di atas Expo, berjalan
pada iOS maupun Android dari satu basis kode.

Repositori ini memuat **kode sumber aplikasi saja**. Dokumentasi penelitian,
perkakas kalibrasi luring, dan berkas kerja lainnya tidak disertakan karena
tidak diperlukan untuk membangun maupun menjalankan aplikasi.

## Verifikasi wajah

Seluruh pengenalan wajah berjalan **di dalam perangkat**. Citra wajah tidak
dikirim ke layanan pihak ketiga mana pun.

| Tahap | Rincian |
| --- | --- |
| Deteksi | ML Kit: kotak pembatas, titik penanda mata, sudut kepala |
| Gerbang mutu | lebar wajah ≥ 0,15 lebar bingkai; yaw ≤ 25°; pitch ≤ 20°; peluang mata terbuka ≥ 0,4 |
| Keaktifan | dua tolehan kepala berlawanan arah, ambang 20° dengan netral 10° |
| Penyelarasan | templat kanonik dua titik mata, lalu diubah ke 112 × 112 piksel |
| Embedding | MobileFaceNet melalui TensorFlow Lite, 192 dimensi, ternormalisasi L2 |
| Pembanding | cosine similarity, diagregasi dengan **median** terhadap seluruh wajah terdaftar |
| Ambang | 0,673 |
| Pendaftaran | 3 sampai 5 foto selfie; tiap foto wajib mirip (≥ 0,45) dengan foto sebelumnya |

Putusan akhir dipisahkan sebagai fungsi murni `decideAttendance()` di
[`utils/verificationAgent.ts`](utils/verificationAgent.ts) supaya dapat diuji
tanpa perangkat.

Presensi juga dibatasi radius **10 km** dari posko
([`utils/geofence.ts`](utils/geofence.ts)). Bila lokasi posko tidak dapat
ditentukan sama sekali, pemeriksaan jarak dilewati dan verifikasi wajah menjadi
pertahanan utamanya.

## Teknologi

- Expo SDK 54, React Native 0.81, React 19, New Architecture aktif
- `expo-router` untuk routing berbasis berkas
- `react-native-vision-camera` 5 dan `react-native-vision-camera-face-detector` 2
- `react-native-fast-tflite` 3
- `@react-native-async-storage/async-storage`, `expo-location`,
  `expo-image-manipulator`

## Menjalankan

```bash
npm install     # postinstall menjalankan patch-package + patch manual
npx expo start
```

Modul asli yang dipakai (kamera dan TensorFlow Lite) tidak tersedia di Expo Go,
sehingga aplikasi harus dijalankan sebagai *development build*, bukan lewat
aplikasi pratinjau.

## Membangun

### iOS

Melalui GitHub Actions, berkas alur kerja
[`.github/workflows/build-ios.yml`](.github/workflows/build-ios.yml), pada
runner macOS. Pengembangan dilakukan di Windows sehingga Xcode tidak tersedia
secara lokal. Keluarannya berupa IPA tanpa tanda tangan yang ditandatangani
ulang lalu dipasang pada perangkat uji.

### Android

```bash
npx expo run:android --variant release
```

Build gradle gagal bila jalur proyek memuat spasi — kegagalannya muncul sebagai
`ninja still dirty`. Salin proyek ke jalur tanpa spasi, misalnya `C:\lkh`, lalu
bangun dari sana dengan JDK 17.

## Tata letak

| Direktori | Isi |
| --- | --- |
| `app/` | layar beranda dan routing |
| `components/` | layar LKH, profil peserta, profil dosen, masuk akun, modal pendaftaran wajah |
| `hooks/` | gerbang mutu wajah dan tantangan keaktifan |
| `utils/` | inferensi wajah, pendaftaran, agen keputusan, geofence, klien API peladen |
| `plugins/` | plugin konfigurasi Expo |
| `patches/`, `scripts/` | tambalan paket pihak ketiga yang diterapkan saat `npm install` |
| `assets/models/` | berkas model MobileFaceNet TFLite |

## Konteks

Purwarupa yang dikembangkan untuk penelitian skripsi pada Program Studi Teknik
Informatika, Universitas Islam Negeri Alauddin Makassar.
