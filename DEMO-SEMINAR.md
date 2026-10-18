# Build demo untuk seminar proposal

Berkas ini hanya ada di cabang `demo/seminar`. Cabang ini **tidak** untuk
digabung ke `main`.

## Cara mengenali build demo

Buka aplikasi. Di layar login ada tombol bergaris hijau **MASUK DEMO** dan
tulisan kecil "Mode demo: data contoh, tidak terhubung server".

**Kalau tombol itu tidak ada, build-nya BUKAN demo** — jangan dipakai untuk
peragaan. Artinya build-nya dibuat dari cabang lain, bukan `demo/seminar`.

Nama berkasnya juga ditandai: IPA dari Actions berakhiran `-demo`.

## Yang dimatikan, dan yang tidak

| | |
|---|---|
| Seluruh permintaan ke server kampus | dijawab data contoh di dalam aplikasi |
| Unduhan foto profil | dilewati, jatuh ke avatar inisial |
| GPS / geofence | dilewati, tanpa minta izin lokasi |
| Nominatim | tidak pernah dipanggil |
| **Verifikasi wajah** | **tetap asli** — enrollment, pencocokan, ambang 0,673, tantangan keaktifan, semuanya di perangkat |

Wajah yang didaftarkan saat demo masuk ruang simpan `_demo` yang terpisah,
jadi **tidak menimpa** data wajah akun asli. Tidak ada embedding yang
terkirim ke server, karena sesi demo memakai `DEMO_TOKEN` yang sudah ditolak
`faceServer.isUsableSession()`.

## Alur peragaan

1. Buka aplikasi → tombol **MASUK DEMO - MAHASISWA**.
2. Layar LKH muncul. Hari ini sengaja **belum terabsen**, beberapa hari
   sebelumnya sudah — jadi absensi bisa diperagakan langsung.
3. Daftarkan wajah, lalu absen. Seluruh pipeline berjalan asli.
4. Untuk sisi dosen: keluar, pindah tab ke **Dosen**, tombolnya berubah
   menjadi **MASUK DEMO - DOSEN**. Ada lima mahasiswa bimbingan contoh dan
   kalender kehadiran yang terisi sebagian.

## Uji terima sebelum hari H

Jalankan di **mode pesawat**. Kalau seluruh alur di atas jalan tanpa sinyal
sama sekali, panggung aman. Itu satu-satunya uji yang benar-benar
membuktikannya — bukan mencobanya sambil wifi menyala.

## Membangun ulang

Saklarnya ada di dalam sumber (`MODE_LOKAL` di `utils/modeLokal.ts`), bukan
variabel lingkungan — jadi tidak ada yang bisa lupa disetel. Yang menentukan
hanya satu: **bangun dari cabang `demo/seminar`.**

**IPA** — tab Actions di GitHub, workflow "Build iOS IPA", Run workflow,
pilih cabang `demo/seminar`, runner `macos-26`.

**APK** — harus dari jalur tanpa spasi (`C:\lkh`), kalau tidak gradle gagal
dengan "ninja still dirty":

```bash
# 1. segarkan sumber - WAJIB dari Bash, bukan PowerShell (pipe binernya rusak)
cd "/c/Users/As Shadiq Nur/Documents/Skripsi/lkh-kkn-ios/lkh-kkn-ios"
git archive demo/seminar | tar -x -C /c/lkh
```

```powershell
# 2. prebuild - JANGAN DILEWATI, lihat peringatan di bawah
cd C:\lkh
npx expo prebuild --platform android

# 3. build
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
& "C:\lkh\android\gradlew.bat" -p "C:\lkh\android" assembleRelease -PreactNativeArchitectures=arm64-v8a
```

### Kenapa langkah prebuild tidak boleh dilewati

Melewatinya sudah sekali membuat APK yang **crash begitu kamera dibuka**:

```
FATAL EXCEPTION: PreviewView.previewOutput:
Cannot cast dynamic to a jsi::Value type
```

Sebabnya: `plugins/withRawPropsJsiValueFix.js` menyalakan feature flag
`useRawPropsJsiValue` dengan menyuntik kode ke `MainApplication.kt`. Ia
sebuah *config plugin*, jadi hanya berjalan saat `expo prebuild`. Dan folder
`android/` **tidak terlacak git** - ia hasil generate - sehingga suntikannya
tidak ikut tersimpan di repo. Membangun langsung dengan gradle memakai
`MainApplication.kt` lama yang belum ditambal, dan Nitro gagal membaca prop
`previewOutput`.

Periksa sesudah prebuild:

```bash
grep -c useRawPropsJsiValue /c/lkh/android/app/src/main/java/com/gieka21/lkhkknios/MainApplication.kt   # harus 1
```

Build iOS lewat Actions aman dari jebakan ini - workflow-nya memang
menjalankan `expo prebuild --platform ios --clean`.

`git archive` menimpa berkas sumber tapi mempertahankan `node_modules` dan
cache gradle, yang menghemat banyak waktu. `C:\lkh` bukan repo git, jadi
sumbernya memang harus disegarkan seperti itu setiap kali — kalau tidak,
APK-nya dibangun dari sumber lama.

Hasilnya di `C:\lkh\android\app\build\outputs\apk\release\app-release.apk`.

## Cara memastikan sebuah build benar-benar demo

Teks `Mode lokal:` hanya bertahan di bundel kalau `MODE_LOKAL` bernilai
benar; kalau salah, minifier membuang seluruh isi penjaganya. Jadi:

```bash
unzip -p app-release.apk assets/index.android.bundle | grep -c "Mode lokal:"
```

Hasil `1` berarti build demo. Hasil `0` berarti build biasa — jangan dipakai.
Nama data contoh seperti "Mahasiswa Demo" TIDAK bisa dipakai sebagai patokan,
karena konstanta tingkat modul tetap ikut terbundel walau saklarnya mati.

## Kalau ada yang bertanya

"Ini mode demo, tidak terhubung server." Itu benar apa adanya, dan sekaligus
menjelaskan kenapa datanya contoh.
