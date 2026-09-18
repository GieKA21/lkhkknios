# Panduan Penulisan Skripsi — Petunjuk, Prompt, & Bahan Rumusan Masalah

Berkas ini berisi tiga hal siap pakai untuk Proyek di claude.ai:

1. **Isi kotak "Petunjuk"** (Custom Instructions)
2. **Prompt bertahap** untuk menghasilkan Halaman Sampul → Bab III → Daftar Pustaka
3. **Bahan Latar Belakang & Rumusan Masalah** dari pengalaman KKN Anda

---

# 1. ISI KOTAK "PETUNJUK"

> Salin seluruh blok di bawah ini ke **Proyek → Petunjuk (+)**.

```
PERAN
Anda adalah pendamping penulisan skripsi saya di Program Studi Teknik
Informatika, UIN Alauddin Makassar.

JUDUL
"Pengembangan Presensi Berbasis Face Verification dan Intelligent Agent pada
Aplikasi KKN Cross-Platform Menggunakan React Native."

JENIS PENELITIAN
Penelitian dan Pengembangan (Research and Development / R&D). Produk yang
dikembangkan adalah aplikasi presensi KKN lintas platform berbasis verifikasi
wajah dengan agen cerdas.

BERKAS DI KONTEKS PROYEK
1. Template KTI (format Word) - versi TERISI dan versi KOSONGAN.
   Ini ACUAN MUTLAK untuk format. Gunakan untuk menentukan:
   - penomoran dan hierarki BAB, sub-bab, sub-sub-bab, hingga tingkat terkecil
   - gaya penomoran (contoh: A. / 1. / a. / 1) / a) / (1) / (a)) - IKUTI PERSIS
     yang ada di template, JANGAN memakai gaya lain
   - penulisan judul bab dan sub-bab (kapitalisasi, tebal/miring, rata kiri
     atau rata tengah)
   - format tabel, gambar, dan penomorannya (Tabel 4.1, Gambar 3.2, dst.)
   - gaya sitasi dan format daftar pustaka
   - susunan halaman awal (sampul, persetujuan, pengesahan, pernyataan
     keaslian, kata pengantar, daftar isi, daftar tabel, daftar gambar, abstrak)
2. konteks-skripsi-lengkap.md - SUMBER FAKTA teknis: arsitektur aplikasi,
   spesifikasi Intelligent Agent (PEAS), hasil kalibrasi, dan angka pengujian.

ATURAN FORMAT (WAJIB)
- SELALU periksa template KTI sebelum menulis struktur apa pun. Kalau saya
  minta satu bab, cocokkan dulu hierarki dan penomorannya dengan template.
- Jangan mengarang struktur bab. Kalau sebuah bagian tidak ada di template,
  katakan dan tanyakan kepada saya.
- Daftar isi mengikuti ketentuan skripsi R&D dan template: BAB I PENDAHULUAN,
  BAB II TINJAUAN PUSTAKA, BAB III METODOLOGI PENELITIAN, BAB IV HASIL DAN
  PEMBAHASAN, BAB V PENUTUP - kecuali template menentukan lain, maka TEMPLATE
  YANG MENANG.
- Bahasa Indonesia akademik baku sesuai PUEBI/EYD. Kalimat efektif, tanpa
  bahasa percakapan, dan hindari kata "kita" (gunakan "peneliti" atau bentuk
  kalimat pasif).

ATURAN ISI (WAJIB)
- JANGAN MENGARANG: angka, hasil pengujian, nama penulis, judul jurnal, tahun,
  DOI, atau referensi apa pun. Ini aturan terpenting.
- Seluruh angka teknis HANYA boleh diambil dari konteks-skripsi-lengkap.md.
  Kalau saya meminta angka yang tidak ada di sana, katakan "data belum
  tersedia" dan minta saya melengkapinya.
- Untuk setiap sitasi, tandai tingkat keyakinan:
  [PASTI]   = yakin sumbernya ada dan datanya benar
  [PERIKSA] = kemungkinan ada, tetapi saya WAJIB memverifikasi sendiri
  Jangan pernah menulis sitasi tanpa salah satu penanda ini.
- Bedakan dengan tegas mana yang SUDAH DIUJI di perangkat dan mana yang masih
  rancangan atau belum diuji. Jangan menulis klaim keberhasilan untuk hal yang
  belum diuji.
- Jangan menyebut sistem ini sudah dipakai menggantikan aplikasi resmi kampus.
  Statusnya PROTOTIPE untuk keperluan percobaan penelitian.

ISTILAH YANG HARUS TEPAT
- TensorFlow Lite = kerangka kerja inferensi machine learning on-device
  (BUKAN "agen AI", BUKAN "model").
- MobileFaceNet = model deep learning (CNN) untuk face embedding.
- Intelligent Agent = goal-based agent dengan sub-loop model-based reflex
  (taksonomi Russell & Norvig), diwujudkan pada modul verifikasi wajah dan
  tantangan keaktifan (liveness). Agen TIDAK belajar saat runtime - jangan
  mengklaimnya sebagai learning agent.

TIGA SISTEM YANG BERBEDA (JANGAN PERNAH TERTUKAR)
1. APLIKASI ANDROID RESMI KAMPUS - dibangun dengan Flutter/Dart. Ini adalah
   SISTEM YANG SEDANG BERJALAN: objek yang dianalisis dan dikritik dalam
   penelitian ini. BUKAN buatan peneliti; hanya direkayasa balik untuk
   dipelajari kelemahannya.
2. SERVER/BACKEND KAMPUS - berbasis PHP. Bukan buatan peneliti dan tidak
   diubah; hanya dipakai sebagaimana adanya.
3. APLIKASI HASIL PENGEMBANGAN PENELITI - React Native, satu basis kode untuk
   iOS dan Android. Inilah PRODUK penelitian ini. Versi iOS sudah terbangun
   dan diuji; versi Android BELUM terbangun.

Aturan penyebutan:
- Jangan pernah menulis "aplikasi Android" tanpa keterangan - ambigu.
- Sebut "aplikasi Android resmi" atau "sistem yang sedang berjalan" untuk
  nomor 1.
- Sebut "aplikasi hasil pengembangan" atau "aplikasi yang diusulkan" untuk
  nomor 3, dan tambahkan "versi iOS"/"versi Android" bila perlu.
- Keberadaan aplikasi resmi TIDAK berarti versi Android hasil pengembangan
  sudah ada. Keduanya sistem yang sama sekali berbeda.

KETETAPAN PENELITIAN (sudah saya putuskan - jangan tawarkan alternatif)
- Model pengembangan: PROTOTYPING (Pressman), 5 tahap - komunikasi,
  perencanaan cepat, pemodelan rancangan cepat, konstruksi prototipe,
  penyerahan dan umpan balik - yang berputar dalam beberapa iterasi.
  BUKAN Waterfall. Alasannya: pengembangan benar-benar berlangsung iteratif,
  setiap iterasi dipicu temuan pengujian di perangkat nyata.
- Penomoran tabel dan gambar: per bab (Tabel 3.1, Gambar 4.2), judul tabel
  DI ATAS tabel dan judul gambar DI BAWAH gambar - KECUALI template KTI
  menentukan lain, maka template yang menang.
- Lokasi penelitian ditulis terpisah menjadi dua: (a) lokasi pengembangan
  sistem, dan (b) lokasi pengujian serta pengambilan data.

CARA MERESPONS
- Kalau ruang lingkup permintaan saya ambigu, tanyakan dulu sebelum menulis.
- Tulis dalam potongan yang bisa saya tinjau (satu sub-bab atau satu bab per
  respons), bukan seluruh skripsi sekaligus.
- Di akhir setiap bagian, sebutkan singkat: (a) data apa yang masih saya
  perlukan, dan (b) sitasi mana yang berstatus [PERIKSA].
```

---

# 2. PROMPT BERTAHAP

> **Kenapa bertahap?** Meminta "sampul sampai Bab III sekaligus" menghasilkan
> tulisan dangkal dan sitasi yang rawan mengada-ada. Dipecah per tahap,
> hasilnya jauh lebih dalam dan bisa Anda periksa sebelum lanjut.
>
> **Sebelum mulai:** unggah berkas panduan ini ke Konteks Proyek juga, supaya
> Bagian 3 (Bahan Latar Belakang) dan Bagian 4 (Ketetapan Metodologi) bisa
> dirujuk tanpa perlu ditempel ulang di tiap prompt.
>
> **Soal format Word:** keluaran Claude TIDAK akan langsung sesuai format UIN
> Alauddin (margin 4-3-3-3 cm, Times New Roman 12, spasi ganda, nomor halaman
> romawi lalu arab). Alur yang benar: salin teksnya, buka template KOSONGAN di
> Word, tempel dengan Paste as Plain Text (Ctrl+Shift+V), lalu terapkan Style
> bawaan template (Heading 1 untuk BAB, Heading 2 untuk sub-bab). Menempel
> biasa akan menimpa format template dan menambah pekerjaan.

## Prompt 0 — Pembuka (jalankan sekali)

```
Sebelum menulis apa pun, baca kedua berkas di Konteks Proyek, lalu laporkan:

1. Struktur dan penomoran yang Anda tangkap dari template KTI - tuliskan
   hierarkinya (BAB, sub-bab, sub-sub-bab) beserta contoh penomorannya.
2. Susunan halaman awal (sampul sampai abstrak) sesuai template.
3. Gaya sitasi dan format daftar pustaka yang dipakai template.
4. Daftar isi lengkap yang Anda usulkan untuk skripsi R&D ini, sampai tingkat
   sub-sub-bab, untuk Bab I sampai Bab III.

Jangan menulis isi bab dulu. Saya ingin menyetujui kerangkanya lebih dahulu.
```

## Prompt 1 — Halaman awal

```
Buatkan halaman awal sesuai template KTI: Halaman Sampul, Halaman Persetujuan
Pembimbing, Halaman Pengesahan, Pernyataan Keaslian Skripsi, Kata Pengantar,
Daftar Isi, Daftar Tabel, Daftar Gambar, dan Abstrak (Indonesia + Inggris).

Untuk data yang belum saya berikan (nama pembimbing, NIP, tanggal, nomor
halaman), tulis placeholder dalam kurung siku seperti [NAMA PEMBIMBING I].
Abstrak maksimal 250 kata, memuat masalah, metode, hasil, dan kesimpulan,
dengan 4-5 kata kunci.
```

## Prompt 2 — Bab I

```
Tulis BAB I PENDAHULUAN dengan sub-bab PERSIS seperti template KTI
(Lampiran 25), termasuk penamaan dan urutannya. JANGAN memakai struktur
Teknik Informatika generik. Catatan yang sudah dipastikan:
- Gunakan "Fokus Penelitian dan Deskripsi Fokus", BUKAN "Definisi
  Operasional Variabel" - istilah terakhir untuk penelitian kuantitatif
  lapangan dan akan terbaca salah kaprah pada penelitian R&D.
- "Kajian Pustaka" WAJIB ada dan memuat penelitian terdahulu.
- "Spesifikasi Produk" WAJIB ada.
- "Sistematika Penulisan" tidak ada di Lampiran 25 - jangan ditambahkan
  kecuali pembimbing mengizinkan.

Latar Belakang WAJIB dibangun dari pengalaman lapangan saya yang saya
lampirkan di pesan ini (bagian "Bahan Latar Belakang"). Susun mengerucut:
konteks umum KKN dan presensi digital -> masalah lintas platform -> masalah
akurasi verifikasi wajah -> masalah keamanan (titip absen dan spoofing foto)
-> celah penelitian -> solusi yang ditawarkan.

Rumusan Masalah dibuat 4 butir, sejalan dengan Latar Belakang.
Setiap klaim umum tentang KKN atau presensi biometrik yang membutuhkan
rujukan, beri sitasi bertanda [PASTI] atau [PERIKSA].
```

## Prompt 3 — Bab II

```
Tulis BAB II TINJAUAN PUSTAKA sesuai template. Cakupan:
- Presensi digital dan biometrik
- Pengenalan wajah: deteksi, penyelarasan (alignment), ekstraksi ciri
  (embedding), dan pencocokan
- MobileFaceNet dan arsitektur CNN untuk face embedding
- TensorFlow Lite (LiteRT) sebagai runtime inferensi on-device
- Intelligent Agent: definisi, PEAS, taksonomi Russell & Norvig
- Anti-spoofing dan liveness detection
- Pengembangan lintas platform dengan React Native
- Metrik evaluasi biometrik: FAR, FRR, EER, d-prime
- Penelitian terdahulu (minimal 5, buatkan tabel perbandingan)
- Kerangka pikir

Untuk setiap referensi, beri penanda [PASTI]/[PERIKSA]. Untuk penelitian
terdahulu, sebutkan penulis, tahun, metode, dan hasil - dan tandai [PERIKSA]
jika Anda tidak sepenuhnya yakin datanya akurat.
```

## Prompt 4 — Bab III

```
Tulis BAB III METODOLOGI PENELITIAN sesuai template, untuk penelitian R&D.
Cakupan:
- Jenis penelitian
- Lokasi penelitian, ditulis terpisah: (a) lokasi pengembangan sistem, dan
  (b) lokasi pengujian dan pengambilan data
- Pendekatan penelitian
- Sumber data
- Metode pengumpulan data
- Instrumen penelitian (perangkat keras dan lunak - ambil dari
  konteks-skripsi-lengkap.md)
- Teknik pengolahan dan analisis data
- Metode pengembangan sistem: gunakan model PROTOTYPING (Pressman). Jelaskan
  kelima tahapnya, lalu uraikan iterasi yang benar-benar terjadi pada
  penelitian ini (lihat bagian "Iterasi Prototipe" yang saya lampirkan).
  Jelaskan pula alasan memilih Prototyping dan bukan Waterfall.
- Analisis sistem yang sedang berjalan: aplikasi Android resmi kampus
  (Flutter), beserta kelemahannya yang terukur - pemotongan wajah berbasis
  kotak deteksi tanpa penyelarasan kanonik, skor impostor terburuk 0,748 yang
  melampaui skor genuine terburuk 0,423, ketiadaan deteksi keaktifan, serta
  penempatan tombol reset yang berdampingan dengan tombol logout
- Analisis sistem yang diusulkan: aplikasi React Native lintas platform
  dengan penyelarasan kanonik, ambang terkalibrasi, dan agen liveness
- Perancangan sistem: arsitektur, flowchart, use case, rancangan antarmuka
- Rancangan pengujian: akurasi verifikasi wajah, FAR/FRR, waktu verifikasi,
  robustness terhadap pencahayaan, efektivitas liveness (anti-spoofing),
  konsumsi sumber daya, keberhasilan deployment, serta performa dan
  konsistensi fungsi antara Android dan iOS

Jelaskan spesifikasi Intelligent Agent dengan PEAS sesuai
konteks-skripsi-lengkap.md. Tegaskan mana pengujian yang SUDAH dilakukan dan
mana yang masih rencana.
```

## Prompt 5 — Daftar Pustaka & validasi sitasi

```
Kumpulkan seluruh sitasi yang muncul di Bab I sampai Bab III, lalu:

1. Susun Daftar Pustaka sesuai gaya di template KTI.
2. Buat tabel verifikasi dengan kolom: No | Sitasi dalam teks | Referensi
   lengkap | Status ([PASTI]/[PERIKSA]) | Cara saya memverifikasi.
3. Untuk setiap referensi [PERIKSA], tuliskan kata kunci pencarian yang harus
   saya pakai di Google Scholar agar saya bisa memastikan sumbernya nyata.
4. Tandai referensi yang terbit lebih dari 10 tahun lalu, agar saya
   pertimbangkan menggantinya dengan yang lebih mutakhir.

PENTING: jangan menambah referensi baru yang tidak dipakai di teks, dan
jangan "melengkapi" data bibliografi yang tidak Anda yakini.
```

---

# 3. BAHAN LATAR BELAKANG & RUMUSAN MASALAH

> Tempelkan bagian ini bersama Prompt 2. Inilah kekuatan skripsi Anda:
> masalahnya nyata, dialami sendiri, dan terbukti secara teknis.

## 3.1 Pengalaman lapangan (fakta yang dialami peneliti)

1. **Keterbatasan platform.** Aplikasi presensi KKN yang disediakan kampus
   hanya tersedia untuk sistem operasi Android, sehingga mahasiswa pengguna
   iPhone tidak dapat memasangnya.

2. **Ketergantungan pada perangkat orang lain.** Mahasiswa pengguna iPhone
   harus meminjam perangkat Android teman setiap kali mengisi presensi.

3. **Beban perangkat ganda.** Sebagian mahasiswa membawa dua perangkat, satu
   di antaranya Android yang hanya difungsikan untuk mengisi presensi.

4. **Kegagalan verifikasi pada pemilik akun yang sah.** Peneliti berulang kali
   gagal diverifikasi oleh sistem meskipun telah mencoba berbagai posisi dan
   ekspresi wajah — indikasi tingkat penolakan palsu (false rejection) yang
   tinggi.

5. **Kuota reset wajah habis tanpa disadari.** Saat hendak mendaftarkan ulang
   wajah, kuota reset tercatat 0 dari 3, padahal peneliti baru menggunakannya
   satu kali. Pada aplikasi tersebut, tombol "Reset Wajah" dan "Logout"
   tersusun berdekatan secara vertikal, sehingga diduga terjadi salah tekan
   oleh pengguna perangkat — sebuah persoalan perancangan antarmuka untuk
   aksi yang bersifat merusak (destructive action).

6. **Penerimaan palsu (false acceptance).** Ketika pemilik perangkat, yang
   merupakan orang lain, melakukan presensi menggunakan akun peneliti, sistem
   MENERIMA wajah tersebut sebagai wajah peneliti. Akibatnya, sampai KKN
   berakhir, presensi atas nama akun peneliti dilakukan oleh orang lain.

7. **Presensi berhasil di luar jangkauan lokasi posko.** Pembatasan lokasi
   tidak efektif mencegah presensi dari luar area yang seharusnya.

8. **Serangan spoofing foto.** Presensi berhasil dilakukan dengan cara
   menghadapkan foto selfie yang ditampilkan pada layar perangkat lain ke
   kamera aplikasi.

## 3.2 Jembatan ke temuan teknis

Butir 4 dan 6 tampak berlawanan (pemilik sah ditolak, orang lain diterima),
tetapi keduanya berasal dari SATU sebab yang sama dan telah dibuktikan secara
terukur pada penelitian ini: pipeline pengenalan wajah pada aplikasi tersebut
memotong wajah berdasarkan kotak deteksi (bounding box) tanpa penyelarasan
kanonik. Akibatnya ruang embedding mengalami kolaps — skor kemiripan antar
orang yang berbeda menjadi tinggi (rata-rata 0,656 dan terburuk 0,748),
bahkan MELAMPAUI skor terburuk sesama orang yang sama (0,423). Pada kondisi
demikian, tidak ada nilai ambang mana pun yang dapat memisahkan keduanya.
Inilah penjelasan mengapa wajah orang lain dapat diterima sementara wajah
pemilik sendiri dapat ditolak.

Setelah penyelarasan kanonik ArcFace diterapkan pada prototipe yang
dikembangkan, daya pisah meningkat tajam: d-prime dari 2,64 menjadi 6,37 dan
EER dari 11,4% menjadi 0,00%. (Sumber angka: konteks-skripsi-lengkap.md.)

## 3.3 Usulan Rumusan Masalah

1. Bagaimana mengembangkan aplikasi presensi KKN lintas platform yang dapat
   berjalan pada sistem operasi Android maupun iOS dari satu basis kode
   menggunakan React Native?

2. Bagaimana meningkatkan akurasi verifikasi wajah pada aplikasi presensi KKN
   sehingga dapat menekan penolakan terhadap pengguna yang sah sekaligus
   mencegah penerimaan terhadap pengguna yang tidak berhak?

3. Bagaimana menerapkan intelligent agent dengan tantangan keaktifan
   (liveness) untuk mencegah kecurangan presensi menggunakan foto?

4. Bagaimana tingkat kinerja aplikasi yang dikembangkan ditinjau dari akurasi
   verifikasi wajah, FAR/FRR, waktu verifikasi, efektivitas anti-spoofing,
   konsumsi sumber daya, serta konsistensi fungsi antara Android dan iOS?

## 3.4 Catatan kejujuran ilmiah

- Butir 5 (kuota reset) berstatus **dugaan** peneliti, bukan fakta
  terverifikasi. Tulis dengan kata "diduga", jangan sebagai temuan pasti.
- Nama teman dan identitas pihak lain **jangan** disebutkan. Gunakan "pemilik
  perangkat" atau "mahasiswa lain".
- Butir 6, 7, dan 8 adalah kelemahan sistem yang berjalan. Tulis secara
  objektif sebagai temuan masalah, tanpa menyalahkan pengembangnya.
- Rumusan masalah nomor 4 mencakup pengujian Android yang **belum** dilakukan.
  Kalau sampai sidang Android belum terbangun, persempit butir tersebut atau
  nyatakan dengan jelas sebagai keterbatasan penelitian.

---

# 4. BAHAN BAB III — KETETAPAN METODOLOGI

> Tempelkan bagian ini bersama Prompt 4.

## 4.1 Model pengembangan: Prototyping (Pressman)

Penelitian ini memakai model **Prototyping**, bukan Waterfall. Alasannya:
kebutuhan sistem tidak dapat dibekukan di awal karena sebagian besar
persoalan baru terungkap setelah prototipe diuji pada perangkat nyata —
misalnya wajah orang lain yang lolos verifikasi dan foto statis yang lolos
presensi. Kedua temuan itu mustahil diketahui dari analisis di atas kertas.

Lima tahap yang berputar: (1) komunikasi, (2) perencanaan cepat,
(3) pemodelan rancangan cepat, (4) konstruksi prototipe, (5) penyerahan
prototipe dan umpan balik.

### Iterasi yang benar-benar terjadi

Tercatat pada riwayat pengembangan (40 commit, 30 Juli – 15 September 2026):

| Iterasi | Temuan pada pengujian prototipe | Perbaikan pada iterasi berikutnya |
|---|---|---|
| 1 | Permintaan login selalu ditolak server | Penyesuaian User-Agent; penambahan mode demo |
| 2 | Wajah terdaftar hilang saat berganti perangkat | Penyimpanan data wajah di sisi server |
| 3 | **Wajah orang lain lolos verifikasi** | Penerapan penyelarasan kanonik ArcFace |
| 4 | Nilai embedding tidak valid (NaN) di perangkat | Penggantian pustaka pengolah citra |
| 5 | Tombol tutup tidak berfungsi; teks tertutup Dynamic Island | Perbaikan area aman antarmuka |
| 6 | **Foto statis lolos presensi** | Penambahan tantangan gerak (liveness) |
| 7 | Pratinjau kamera gelap dan berkedip | Pembatasan laju bingkai dan penguat cahaya rendah |

Iterasi 3 dan 6 adalah yang paling menentukan: keduanya merupakan kegagalan
keamanan yang hanya terungkap melalui pengujian pada perangkat nyata, dan
keduanya menjadi dasar kontribusi utama penelitian ini.

## 4.2 Lokasi penelitian

Ditulis terpisah menjadi dua, karena pengembangan dan pengambilan data
berlangsung di tempat yang berbeda:

```
a. Lokasi pengembangan sistem
   Jurusan Teknik Informatika, Fakultas Sains dan Teknologi,
   Universitas Islam Negeri Alauddin Makassar, serta domisili peneliti.

b. Lokasi pengujian dan pengambilan data
   [ISI: Desa/Kelurahan ..., Kecamatan ..., Kabupaten ...], yaitu lokasi
   Kuliah Kerja Nyata (KKN) Angkatan [ISI] tempat permasalahan penelitian
   ditemukan, dengan subjek uji peserta KKN pada posko tersebut.
```

Yang perlu diisi sendiri: nama desa/kecamatan/kabupaten lokasi KKN dan nomor
angkatan.

## 4.3 Penomoran tabel dan gambar

Ketentuan yang dipakai: penomoran **per bab** — `Tabel 3.1`, `Tabel 3.2`,
`Gambar 4.1` (angka pertama nomor bab, angka kedua urutan dalam bab itu).
Judul tabel diletakkan **di atas** tabel, judul gambar **di bawah** gambar.

Sebelum menulis, buka template KTI versi terisi, cari satu tabel dan satu
gambar, lalu pastikan penomoran dan letak judulnya sama. **Kalau berbeda,
template yang menang** — perbarui ketentuan ini agar sesuai template.

## 4.4 Rencana pengambilan data wajah (Bab III sub-bab D & E)

Pengujian akurasi dibagi menjadi DUA TAHAP yang terpisah. Pemisahan ini
disengaja: menetapkan nilai ambang dari data yang sama dengan data pengujian
bersifat sirkular dan tidak sah secara metodologis.

**Tahap 1 - Kalibrasi dan penetapan ambang (SUDAH dilakukan)**
- Subjek: 6 identitas - 1 pemilik (19 foto, 2 sesi terpisah) dan 5 pembanding
  (4 di antaranya menyumbang 1 foto).
- Kegiatan: sapuan 80 varian preprocessing dan validasi silang 400 subset
  pendaftaran acak berukuran 3-5.
- Hasil: penyelarasan kanonik terpilih; strategi agregasi median terpilih;
  nilai ambang ditetapkan pada 0,47.

**Tahap 2 - Pengujian akurasi (AKAN dilakukan)**
- Subjek: 15 orang yang bersedia, dari kalangan mana pun (teman, keluarga,
  rekan). TIDAK disyaratkan peserta KKN, karena yang dibutuhkan adalah
  keberagaman identitas, bukan status kepesertaan.
- Tiap subjek: 6 foto - 3 foto pendaftaran dan 3 foto uji.
- Perkiraan jumlah percobaan: sekitar 45 percobaan genuine dan sekitar 630
  percobaan impostor (tiap foto uji diadu dengan pendaftaran 14 subjek lain).
- Nilai ambang 0,47 DIKUNCI dan tidak boleh disesuaikan lagi pada tahap ini.
- Keluaran: FAR, FRR, EER, dan akurasi.

**Peran lokasi Amali**
Amali berfungsi sebagai lokasi pengujian fungsional aplikasi dan tempat
permasalahan penelitian ditemukan, bukan sebagai satu-satunya sumber data
wajah.

**Pedoman pengambilan foto**
- Variasikan kondisi: pencahayaan berbeda, dengan dan tanpa kacamata,
  ekspresi berbeda, sedikit menoleh. Kondisi sulit inilah yang menentukan
  seberapa rendah ambang boleh dipasang tanpa menolak pemilik yang sah.
- Foto pendaftaran dan foto uji sebaiknya diambil pada sesi/waktu berbeda,
  agar tidak saling mirip secara artifisial.

**Persetujuan subjek**
Pengambilan data biometrik memerlukan persetujuan. Siapkan pernyataan
kesediaan sederhana yang memuat tujuan penggunaan (penelitian skripsi),
bentuk data yang disimpan, dan hak subjek untuk menarik diri. Lampirkan
formulir tersebut pada bagian lampiran skripsi.

## 4.5 Penempatan bagian

- **Analisis sistem yang sedang berjalan dan sistem yang diusulkan** -> BAB III.
  Pada penelitian R&D keduanya bagian dari metode pengembangan, bukan hasil.
  BAB IV diisi hasil implementasi dan pengujian.
- **Keterbatasan Penelitian** -> BAB V PENUTUP, ditempatkan sebelum Saran.
  JANGAN disamakan dengan Batasan Masalah di Bab I:
  - Batasan Masalah (Bab I) = ruang lingkup yang SENGAJA dipilih peneliti.
  - Keterbatasan Penelitian (Bab V) = kekurangan yang melekat atau ditemukan,
    misalnya jumlah identitas pembanding yang terbatas dan versi Android yang
    belum terbangun.

## 4.6 Hash commit tiap iterasi

| Iterasi | Hash | Tanggal | Isi |
|---|---|---|---|
| 1 | `347cee6` | 2026-08-25 | Dart User-Agent + login demo (didahului probe c62f762, f47733f, 21fba7c) |
| 2 | `b6e0f04` | 2026-08-27 | Penyimpanan wajah di server |
| 3 | `a93515b` | 2026-08-27 | Penyelarasan kanonik - memperbaiki wajah asing yang lolos |
| 4 | `6af9827` | 2026-08-27 | Ganti TensorFlow.js ke jpeg-js - mengatasi embedding NaN |
| 5 | `dd7dc75`, `c2d9a92` | 2026-08-27 | Perbaikan area aman antarmuka |
| 6 | `2437a0b` | 2026-08-29 | Liveness tolehan kepala - menutup celah foto statis |
| 7 | `aa01d78`, `be61a90` | 2026-09-13/15 | Kamera gelap dan berkedip |
