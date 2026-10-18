# Build demo untuk seminar proposal

Berkas ini hanya ada di cabang `demo/seminar`. Cabang ini **tidak** untuk
digabung ke `main`.

## Cara mengenali build demo

Buka aplikasi. Di layar login ada tombol bergaris hijau **MASUK DEMO** dan
tulisan kecil "Mode demo: data contoh, tidak terhubung server".

**Kalau tombol itu tidak ada, build-nya BUKAN demo** — jangan dipakai untuk
peragaan. Artinya `EXPO_PUBLIC_SUMBER=lokal` tidak sampai ke Metro saat
bundel dibuat.

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

**IPA** — tab Actions di GitHub, workflow "Build iOS IPA", Run workflow,
pilih cabang `demo/seminar`, runner `macos-26`. Variabelnya sudah disetel di
dalam workflow cabang ini.

**APK** — harus dari jalur tanpa spasi (`C:\lkh`), kalau tidak gradle gagal
dengan "ninja still dirty":

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
$env:EXPO_PUBLIC_SUMBER = "lokal"
& "C:\lkh\android\gradlew.bat" -p "C:\lkh\android" assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Sumber di `C:\lkh` disegarkan dengan `git archive demo/seminar | tar -x -C /c/lkh`
— cara itu menimpa berkas sumber tapi mempertahankan `node_modules` dan cache
gradle, yang menghemat banyak waktu.

**Variabelnya wajib ada saat bundel dibuat**, bukan sesudahnya. Tanpa itu
hasilnya build biasa yang menghadap server kampus, dan tidak ada pesan galat
apa pun yang memberi tahu — baru kelihatan saat dicoba.

## Kalau ada yang bertanya

"Ini mode demo, tidak terhubung server." Itu benar apa adanya, dan sekaligus
menjelaskan kenapa datanya contoh.
