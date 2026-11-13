# Uji ambang 0,673 pada dataset wajah publik (3 November 2026)

Tujuan: memeriksa apakah FAR 0,00 % yang diukur pada 9 identitas
(HASIL-PENGUKURAN.md, Tabel 4.5-4.6 naskah) bertahan ketika "orang lain"
diperbanyak menjadi ribuan identitas. Ambang **tidak** diubah dan **tidak**
dicari ulang. Skrip: `uji-dataset-publik.py`. Jalur pengolahan sama dengan
aplikasi: BlazeFace, penyelarasan kanonik dua titik mata, 112 x 112,
(x-128)/128, RGB, putusan = median kemiripan terhadap 3 wajah terdaftar.

Kontrol: `ukur-far-frr.py` dijalankan ulang lebih dahulu dan memberi angka
yang sama persis dengan Tabel 4.5 (6.999 genuine rata-rata 0,7974; 100.800
impostor rata-rata 0,3006, tertinggi 0,5433).

## Data

| Dataset | Isi | Sumber unduhan | Pemeriksaan |
|---|---|---|---|
| LFW | 13.233 foto, 5.749 identitas | figshare (cermin scikit-learn), `ndownloader.figshare.com/files/5976018`; `pairs.txt` dari `/files/5976006` | SHA-256 `055f7d9c…d536c0` = nilai resmi scikit-learn |
| CALFW | 3.000 pasangan genuine beda usia + 3.000 impostor sesama jenis kelamin dan ras | whdeng.cn/CALFW (Google Drive) | - |
| CPLFW | 3.000 pasangan genuine beda pose + 3.000 impostor sesama jenis kelamin dan ras | whdeng.cn/CPLFW (Google Drive) | - |

Ketiganya untuk penelitian non-komersial; foto tidak disebarkan ulang.

## Hasil

| Uji | Percobaan impostor | Lolos pada 0,673 | FAR | Batas atas 95 % | Skor impostor tertinggi |
|---|---:|---:|---:|---:|---:|
| A. Pemilik aplikasi (9 identitas) vs seluruh wajah LFW, 20 pengulangan | 2.381.940 | 0 | 0,00 % | 0,00015 % (per percobaan); 0,0071 % (per 51.741 pasangan pemilik x identitas) | 0,6596 |
| B. Protokol BAB IV di dalam LFW (610 pemilik, >= 4 foto) | 16.130.794 | 13 tercatat, **1 sungguhan** | 0,0000062 % | 0,0000345 % | 0,6983 (sungguhan) |
| C. 6.000 pasangan baku LFW (satu lawan satu) | 3.000 | 0 | 0,00 % | 0,123 % | 0,4757 |
| D. CALFW (impostor sesama jenis kelamin dan ras) | 3.000 | 0 | 0,00 % | 0,123 % | 0,5607 |
| D. CPLFW, semua pose | 2.963 | 17 | 0,57 % | 0,92 % | 0,7968 |
| D. CPLFW, disaring gerbang pose aplikasi (\|yaw\| <= 25, \|pitch\| <= 20) | 403 | 0 | 0,00 % | 0,91 % | 0,5236 |

FRR di LFW tinggi: 21,4 % (B, median-of-3), 28,6 % (C, satu foto). Akurasi
terbaik pada pasangan baku LFW adalah 98,75 % di ambang 0,360; pada 0,673
akurasinya 85,70 %, karena ambang ini sengaja ketat.

### Uji B: 12 dari 13 "penerimaan keliru" adalah kesalahan label LFW

Diperiksa satu per satu dengan melihat fotonya:

- Orang yang sama di bawah dua nama: Joseph/Sepp Blatter (4 percobaan),
  Choi Sung-hong/Sung Hong Choi (2), Wang Nan/Nan Wang (1).
- Foto berlabel salah orang: `Recep_Tayyip_Erdogan_0004` berisi Abdullah Gül
  (2), `Carlos_Ruckauf_0001` berisi Eduardo Duhalde (2),
  `Michael_Schumacher_0008` berisi Rubens Barrichello (1).
- **Satu penerimaan keliru sungguhan**: foto Sabah Al-Ahmad Al-Jaber Al-Sabah
  diterima sebagai Taha Yassin Ramadan, skor 0,6983 - dua pria lanjut usia
  berkumis dengan rupa serupa.

Pemindaian lintas-identitas juga menemukan pasangan foto identik di bawah dua
nama (skor 1,000) dan kembar identik Tamara/Tia Mowry (0,840).

### Uji D CPLFW: semua yang lolos adalah foto profil

Ke-17 pasangan yang lolos memuat sedikitnya satu foto dengan |yaw| > 25 derajat
atau wajah yang tidak terbaca oleh FaceLandmarker (foto samping). Pose
diperkirakan dengan FaceLandmarker MediaPipe (`face_landmarker.task`), bukan
ML Kit yang dipakai aplikasi, jadi sudutnya taksiran. Aplikasi tidak pernah
mencocokkan foto seperti itu: gerbang mutu menolak |yaw| > 25 dan |pitch| > 20
(`utils/faceAuthNative.ts`), dan foto diam baru diambil sesudah |yaw| <= 10
(`CENTER_DEG`, `hooks/useLivenessChallenge.ts`).

## Tafsiran

1. Pada kondisi yang paling dekat dengan pemakaian nyata (Uji A), FAR tetap
   0 % terhadap 5.749 identitas.
2. **Ekor sebaran memang memanjang ketika identitas bertambah**: skor impostor
   tertinggi naik dari 0,5433 (8 orang lain) menjadi 0,6596 (5.749 orang lain),
   hanya 0,014 di bawah ambang. Margin 0,13 yang ditulis di naskah terpakai
   hampir seluruhnya - margin itu terbukti diperlukan, dan juga hampir habis.
   Wajah yang paling mendekati "saya" adalah petenis Thailand, yaitu wajah
   Asia Tenggara.
3. Pada 0,673 sistem tidak sempurna: Uji B menemukan satu pasangan orang
   berbeda yang lolos (0,6983).
4. Kondisi foto berpengaruh besar. Rata-rata skor impostor di data aplikasi
   0,3006, sedangkan di LFW sekitar 0,0. Swafoto dengan kamera, ruangan, dan
   populasi yang sama menaikkan skor orang lain. Ekor sebaran pada pemakaian
   nyata karena itu kemungkinan lebih tebal daripada yang tampak di LFW, dan
   LFW tidak dapat menggantikan pengujian dengan lebih banyak mahasiswa.
