# Rencana: perbesar instruksi absen dan tambahkan panah arah

**Status: rencana, belum dikerjakan.** Dibuat 3 November 2026 atas masukan
dosen pembimbing bahwa tulisan instruksi pada absen terlalu kecil. Diperbarui
4 November 2026: mahasiswa memilih versi 3 (huruf besar + panah) pada kanvas
sketsa "Sketsa Instruksi Absen", dan menyunting sendiri bentuk panahnya.

## Persoalan

Instruksi tantangan keaktifan dibaca dalam keadaan paling sulit: ponsel
dipegang sejauh lengan, dan kepala sedang **menoleh**, sehingga layar hanya
terlihat dari sudut mata. Ukuran yang sekarang dipakai tidak dirancang untuk
itu:

| Teks | Letak | Sekarang |
|---|---|---|
| Baris utama instruksi ("Toleh lagi ke sisi yang SAMA") | `kartuJudul`, `components/LKHScreen.tsx` | 18, tebal |
| Keterangan di bawahnya ("Tahan sebentar sampai terdeteksi") | `kartuSub` | 12, putih 68 % |
| Strip kemajuan tantangan | `langkahStrip` | 20 x 5 |
| "Memeriksa identitas" | `bindingText` | 14 |
| Petunjuk di bawah tombol absen | `attendanceHint` | 12 |

Selain kecil, perintah relatif ("sisi yang SAMA" / "SEBALIKNYA") menuntut
pengguna mengingat ke mana tolehan sebelumnya sambil menoleh.

## Bagian A: ukuran huruf (hanya tampilan)

1. **Baris utama 18 → 26**, tebal, `lineHeight` 32.
2. **Keterangan 12 → 16**, warna putih 68 % → 85 %.
3. **Paling banyak dua baris**: `numberOfLines={2}`, `adjustsFontSizeToFit`,
   `minimumFontScale={0.85}` pada baris utama.
4. **Ukuran huruf sistem dihormati tetapi dibatasi**:
   `maxFontSizeMultiplier={1.3}`, supaya kartu tidak menutupi wajah.
5. **Kartu dilebarkan**: `marginHorizontal` 8 → 0, `paddingRight` 18 → 14.
6. **Strip kemajuan 20 x 5 → 28 x 7.**
7. **"Memeriksa identitas" 14 → 18.**
8. **Petunjuk di bawah tombol absen 12 → 14.** Kalimat "radius … dari posko"
   di dalamnya dibetulkan sekalian (butir 2 `naskah/catatan/USULAN-REVISI-2.md`).

## Bagian B: panah arah (versi 3 sketsa)

### Tampilan, mengikuti sunting mahasiswa

- **Tiga tanda `›››` di samping wajah**, setinggi tengah wajah, pada sisi
  yang dituju. Tanda itu memudar ke arah wajah dan paling terang di ujung.
  Lingkaran panah besar dari sketsa awal dibuang oleh mahasiswa.
- **Kartu**: ikon panah kecil di depan baris utama, dan teks
  **"Toleh ke arah panah"**. Kalimat ini muat satu baris pada 26 pt.
- **Tolehan pertama** belum punya arah yang diminta, jadi `‹‹‹` dan `›››`
  tampil di kedua sisi wajah, dengan ikon panah dua arah dan teks
  "Toleh ke salah satu sisi".
- **Fase "Hadapkan lagi ke tengah"**: semua panah disembunyikan.
- Pada sketsa, tanda `›››` menjorok sekitar 27 px melewati tepi layar. Pada
  aplikasi, letaknya di dalam layar dengan jarak tepi 8 px.
- Usulan kecil: tanda paling ujung dibuat putih penuh, tidak 65 %, dengan
  bayangan gelap tipis. Panah adalah petunjuk yang dilihat dari sudut mata,
  dan di ruangan terang putih 35–65 % mudah tenggelam. Diputuskan mahasiswa.

### Logika: TIDAK berubah

Rencana tolehan tetap diundi secara relatif (`undiRencana()`), dan pemeriksaan
tetap membandingkan tanda yaw (`tanda !== harusnya`, `hooks/useLivenessChallenge.ts`).
Yang ditambah hanya **turunan untuk tampilan**: sebelum pengguna menoleh, hook
sudah tahu tanda yang diharapkan
(`diminta === "sama" ? tandaTerakhir : -tandaTerakhir`). Tanda itu
diterjemahkan menjadi sisi layar dan diekspor sebagai
`arahPanah: "kiri" | "kanan" | "keduanya" | null`.

Karena keadaan internal agen sama persis, uraian agen di BAB III/IV
("rencana tolehan yang diundi … arah tolehan terakhir yang dipenuhi") tetap
benar, dan angka pengujian tidak berubah.

### Syarat yang harus dipenuhi lebih dahulu: tanda yaw per platform

Panah menuntut kepastian yang dulu sengaja dihindari (komentar
SIGN-CONVENTION di `hooks/useLivenessChallenge.ts`): yaw positif itu menoleh
ke kanan atau ke kiri pengguna? Jawabannya bergantung pada konvensi detektor
wajah dan pencerminan kamera depan, dan bisa berbeda antara iOS dan Android.
Kalau terbalik, panah menyuruh menoleh ke arah yang salah dan tantangan tidak
pernah lulus.

Karena itu ada satu konstanta per platform, diisi dari **pengukuran di
perangkat, bukan tebakan**:

```
const SISI_YAW_POSITIF: Record<"ios" | "android", "kiri" | "kanan" | null> =
  { ios: null, android: null };
```

- `null` = belum diukur → **panah tidak ditampilkan**, dan instruksi kembali
  ke teks relatif yang sekarang. Jadi build yang belum diukur tetap aman.
- Pengukuran: satu saklar sumber `TAMPILKAN_YAW = false` (pola yang sama
  dengan `ABAIKAN_PERIODE_KKN`) menampilkan angka yaw kecil di pojok layar
  kamera. Dibangun sekali dengan nilai `true`. Penguji menoleh ke **kanan
  dirinya sendiri** di iPhone lalu di Android, mencatat tanda angka yang
  muncul, dan mengisinya ke `SISI_YAW_POSITIF`. Pratinjau kamera depan
  dicerminkan seperti cermin, jadi sisi kanan layar = kanan pengguna. Hal itu
  ikut terbukti pada uji yang sama: panah di kanan, pengguna menoleh ke kanan,
  dan tantangan maju.
- `TAMPILKAN_YAW` harus `false` di git, dan tidak boleh ditemukan pada bundel
  build yang diserahkan.

## Akibat pada naskah

- **Gambar 4.15** (Tantangan Keaktifan pada Layar Presensi) adalah tangkapan
  layar build demo, jadi perlu diambil ulang dari build baru.
- **Gambar 4.11** (wireframe) masih bertuliskan "Tolehkan kepala perlahan ke
  satu sisi". Teks dan panahnya digambar ulang dari
  `gambar-revisi/sumber/flowchart/bab4/Rancangan-Antarmuka-Aplikasi.html`,
  dengan label tetap 9,5 pt.
- Teks BAB III/IV tentang agen tidak perlu diubah karena logikanya sama.
  Bila ingin disebut, cukup satu kalimat pada uraian antarmuka bahwa arah
  tolehan ditunjukkan dengan panah.

## Urutan pengerjaan

1. Bagian A (ukuran huruf). Bisa langsung dibangun dan diuji.
2. Bagian B dengan `SISI_YAW_POSITIF` masih `null` (panah belum tampil) dan
   `TAMPILKAN_YAW` menyala → satu build iOS (GitHub Actions) + satu APK.
3. Pengukuran tanda yaw di iPhone dan Android → isi konstanta, matikan
   `TAMPILKAN_YAW`.
4. Build akhir, lalu uji di kedua perangkat: setiap pesan paling banyak dua
   baris, panah menunjuk sisi yang benar pada semua tolehan, dan kartu tidak
   menutupi wajah pada ukuran huruf sistem terbesar.
5. Ambil ulang Gambar 4.15, gambar ulang Gambar 4.11, lalu masukkan ke
   REVISI-2 naskah.
