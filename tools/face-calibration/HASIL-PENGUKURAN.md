# Hasil Pengukuran Verifikasi Wajah — untuk penulisan skripsi

> **PERINGATAN 5 November 2026**: bagian 2–6 di bawah dihasilkan `ukur-far-frr.py` versi lama yang
> memuat bug irisan (`E[idx[args.enroll] :]`). Angka sisi genuine (6.999 percobaan, FRR 16,03 %,
> d′ 3,066, EER 4,97 %, tabel per identitas) KELIRU. Angka yang benar ada di
> `naskah/catatan/data-uji/log-ukur-far-frr-2026-11-05.txt` dan
> `naskah/catatan/ASAL-USUL-ANGKA-BAB-IV.md`. Bagian 7–9 (sapuan varian, catatan EER 0 %,
> validasi silang) tidak terdampak.

Diukur ulang 2026-09-22 dengan `ukur-far-frr.py` di atas dataset
`tools/face-calibration/photos`. Semua angka di bawah **terukur**, bukan
perkiraan. Konfigurasi yang diukur adalah konfigurasi yang benar-benar
dipakai aplikasi.

## 1. Konfigurasi yang berlaku sekarang

| Parameter | Nilai | Lokasi di kode |
|---|---|---|
| Model | MobileFaceNet TFLite, masukan 112×112, embedding 192-dim | `assets/models/mobilefacenet.tflite` |
| Normalisasi piksel | `(x-128)/128`, kanal RGB | `utils/faceAuthNative.ts` |
| Penyelarasan (alignment) | kanonik ArcFace, 2 titik mata, margin 0.9 | `cropAlignResize()` |
| Metrik | cosine similarity (dot product vektor ternormalisasi L2) | `faceSimilarity()` |
| Agregasi terhadap N wajah terdaftar | **median** | `similarityToEnrollment()` |
| **FACE_MATCH_THRESHOLD** | **0.673** | `utils/faceAuthNative.ts:696` |
| ENROLLMENT_CONSISTENCY_MIN | 0.45 | `utils/faceAuthNative.ts` |
| Quality gate | ukuran wajah ≥ 0.15 lebar bingkai, |yaw| ≤ 25°, |pitch| ≤ 20°, mata terbuka ≥ 0.4 | `hooks/useFaceQualityGate.ts` |
| Liveness | tantangan gerak kepala (menoleh kiri–tengah–kanan) | `hooks/useLivenessChallenge.ts` |

> Ambang **0.673**, bukan 0.47. Nilai 0.47 sudah ditinggalkan sejak
> 2026-09-19 setelah terjadi *false accept* nyata (impostor mencetak 0.479).

## 2. Dataset pengujian

9 identitas, 63 foto (`saya` 7; teman-1..8: 6, 6, 6, 6, 8, 6, 7, 11).

## 3. Protokol pengukuran

Leave-one-identity-out dengan pengulangan acak:

- setiap identitas bergiliran menjadi "pemilik akun";
- 3 fotonya dipilih acak sebagai wajah terdaftar (sesuai jumlah enrollment aplikasi);
- sisa fotonya = percobaan **genuine** (seharusnya diterima);
- seluruh foto 8 identitas lain = percobaan **impostor** (seharusnya ditolak);
- skor tiap percobaan = **median** kemiripan terhadap 3 wajah terdaftar;
- diulang 200 kali per identitas dengan pemilihan acak berbeda.

Total: **6.999 percobaan genuine** dan **100.800 percobaan impostor**.

## 4. Hasil utama (seluruh 63 foto)

Distribusi skor (median-of-3):

| | n | rata-rata | ekstrem |
|---|---|---|---|
| genuine | 6.999 | 0.7974 | min −0.0428 |
| impostor | 100.800 | 0.3006 | maks 0.5433 |

d′ = **3.066**; EER = **4.97%** pada ambang 0.476.

FAR/FRR terhadap ambang:

| Ambang | FAR | FRR | Akurasi |
|---|---|---|---|
| 0.470 (nilai lama di draf skripsi) | 5.82% | 4.90% | 94.24% |
| 0.500 | 2.01% | 6.52% | 97.69% |
| 0.550 | **0.00%** | 6.52% | 99.58% |
| 0.600 | 0.00% | 8.57% | 99.44% |
| 0.650 | 0.00% | 11.37% | 99.26% |
| **0.673 (dipakai sekarang)** | **0.00%** | **16.03%** | **98.96%** |
| 0.700 | 0.00% | 18.10% | 98.82% |
| 0.750 | 0.00% | 26.58% | 98.27% |

## 5. Hasil setelah 2 foto cacat dibuang

Dua foto gagal pada tahap deteksi/penyelarasan, bukan pada tahap pencocokan
(median kemiripan terhadap foto lain dari orang yang sama: teman-3 = 0.409,
teman-4 = −0.042; pada teman-4 jarak antar-mata hanya 78 px dibanding ~180 px
pada foto lain — wajah terlalu dekat ke kamera sehingga landmark meleset).

| | seluruh foto | tanpa 2 foto cacat |
|---|---|---|
| d′ | 3.066 | **4.407** |
| EER | 4.97% | **2.67%** |
| FAR @ 0.673 | 0.00% | 0.00% |
| FRR @ 0.673 | 16.03% | **10.66%** |
| Akurasi @ 0.673 | 98.96% | **99.30%** |

## 6. Rincian per identitas (ambang 0.673, seluruh foto)

| Identitas | n foto | genuine rata² | genuine min | FRR | impostor maks | FAR |
|---|---|---|---|---|---|---|
| saya | 7 | 0.8649 | 0.6726 | 2.57% | 0.5419 | 0.00% |
| teman-1 | 6 | 0.8426 | 0.7084 | 0.00% | 0.4135 | 0.00% |
| teman-2 | 6 | 0.8573 | 0.7616 | 0.00% | 0.5298 | 0.00% |
| teman-3 | 6 | 0.6000 | 0.3618 | 65.32% | 0.4980 | 0.00% |
| teman-4 | 6 | 0.5189 | −0.0428 | 48.44% | 0.5433 | 0.00% |
| teman-5 | 8 | 0.8173 | 0.6225 | 4.56% | 0.5075 | 0.00% |
| teman-6 | 6 | 0.9404 | 0.8245 | 0.00% | 0.5111 | 0.00% |
| teman-7 | 7 | 0.9676 | 0.9515 | 0.00% | 0.5433 | 0.00% |
| teman-8 | 11 | 0.7605 | 0.5698 | 23.83% | 0.5405 | 0.00% |

FRR terpusat pada 3 identitas yang fotonya bermasalah (terlalu dekat ke
kamera / miring, sehingga area potong kanonik terpotong tepi gambar).
Enam identitas lain ber-FRR 0–4.6%.

## 7. Sapuan 80 varian pra-pemrosesan (`hasil-kalibrasi.csv`)

Protokol berbeda: setiap foto dibandingkan dengan setiap foto lain
(tanpa agregasi). Varian terbaik = `(x-128)/128`, margin 0.9, alignment
kanonik, RGB, tanpa mirror:

d′ 2.910 · EER 5.97% pada 0.483 · akurasi 99.18% · genuine rata² 0.776 ·
impostor rata² 0.295 · impostor maks 0.611.

d′ terbaik per (alignment, margin) — memperlihatkan bahwa potongan longgar
ala *bounding box* memang memperburuk daya pisah:

| align | margin | d′ | EER | akurasi |
|---|---|---|---|---|
| ya | 0.9 | **2.910** | 5.97% | 99.18% |
| tidak | 0.9 | 2.878 | 5.99% | 98.98% |
| ya | 1.0 | 2.764 | 7.01% | 98.41% |
| tidak | 1.0 | 2.574 | 10.50% | 98.57% |
| ya | 1.1 | 2.456 | 10.50% | 97.80% |
| tidak | 1.1 | 2.480 | 10.50% | 97.95% |
| ya | 1.2 | 2.416 | 11.51% | 97.34% |
| tidak | 1.2 | 2.444 | 11.00% | 97.80% |

RGB lebih baik daripada BGR (d′ maks 2.910 vs 2.770).

## 8. Catatan penting tentang angka "EER 0,00%"

Komentar di `utils/faceAuthNative.ts` menyebut "EER 0,00% pada ambang 0.673
(d′ 4.225)". Angka itu **direproduksi dan benar**, tetapi berasal dari
protokol `aggregation_study()` yang jauh lebih sempit: hanya identitas
`saya` sebagai pemilik, 3 foto pertama sebagai enrollment, dan hanya
**4 percobaan genuine**. Dengan 4 percobaan, EER 0% mudah tercapai dan tidak
dapat dianggap mewakili.

Protokol pada bagian 3 (6.999 percobaan genuine, 9 identitas) adalah angka
yang layak ditulis di skripsi.

## Cara mengulang pengukuran

```
cd tools/face-calibration
./.venv/Scripts/python.exe ukur-far-frr.py --thresholds 0.47 0.55 0.60 0.673
./.venv/Scripts/python.exe ukur-far-frr.py --buang-pencilan
./.venv/Scripts/python.exe diagnosa-foto.py     # cari foto yang deteksinya meleset
```

---

# 9. Evaluasi tidak sirkular (validasi silang antaridentitas)

Ditambahkan 2026-09-22, diukur dengan `validasi-silang.py`.

**Masalah yang dipecahkan.** Menetapkan ambang lalu mengukur FAR/FRR pada
data yang sama bersifat sirkular. Pemisahan dilakukan pada tingkat
**identitas**, bukan sekadar foto: 4 identitas ditahan sebagai data uji dan
5 sisanya dipakai menetapkan ambang. Pemisahan diputar ke **seluruh 126
kombinasi** agar hasilnya tidak bergantung pada satu pembagian yang kebetulan
menguntungkan.

## A. Ambang dipelajari dari subset kalibrasi, diuji pada identitas ditahan

| Besaran | Rerata | SD | Min | Maks |
|---|---|---|---|---|
| ambang EER yang dipelajari | 0,4966 | 0,0483 | 0,4157 | 0,6726 |
| **FAR** | **5,01%** | 7,25% | 0,00% | 33,02% |
| **FRR** | **6,34%** | 6,46% | 0,00% | 32,53% |
| **Akurasi** | **94,81%** | 5,76% | 71,94% | 100% |

## B. Ambang aplikasi 0,673 dikunci, diuji pada identitas ditahan

| Besaran | Rerata | SD | Min | Maks |
|---|---|---|---|---|
| **FAR** | **0,00%** | 0,0000 | 0,00% | 0,00% |
| **FRR** | **18,44%** | 8,70% | 0,00% | 33,65% |
| **Akurasi** | **97,06%** | 1,39% | 94,48% | 100% |

FAR 0,00% pada **seluruh 126 lipatan** — tidak satu pun wajah bukan pemilik
lolos. Catatan kejujuran: ambang 0,673 semula diturunkan dari data seluruh 9
identitas, sehingga bagian B tidak sepenuhnya bebas kontaminasi. Bagian A
sepenuhnya bersih dan merupakan angka yang paling aman dipertahankan.

# 10. Koreksi: klaim potongan kotak vs penyelarasan kanonik

Naskah menyebut pemotongan kotak menghasilkan rerata kemiripan antarorang
0,656 (terburuk 0,748) dibanding penyelarasan kanonik 0,338 (terburuk 0,500).
**Angka tersebut tidak dapat direproduksi pada dataset 9 identitas:**

| Konfigurasi | d′ | EER | impostor rata² | impostor maks |
|---|---|---|---|---|
| potongan kotak margin 1,3 | 2,409 | 11,51% | 0,319 | 0,662 |
| potongan kotak margin 2,0 | 2,480 | 11,00% | 0,329 | 0,662 |
| potongan kotak margin 3,0–6,0 | 2,477 | 11,51% | 0,327 | 0,662 |
| **penyelarasan kanonik margin 0,9** | **2,910** | **5,97%** | **0,295** | **0,611** |

Nilai jenuh pada margin ≥ 3,0 karena area potong terbentur tepi gambar lalu
dipangkas (perilaku yang sama dengan aplikasi). Seluruh foto dataset ini
adalah swafoto jarak sangat dekat sehingga pemotongan selalu terbentur tepi;
dampak buruk potongan kotak karenanya teredam. Dataset kalibrasi pertama
(Agustus, 6 identitas) berbingkai lebih longgar sehingga memperlihatkan
dampak yang jauh lebih besar.

**Arah klaim tetap benar** (penyelarasan kanonik menurunkan EER hampir
separuh: 11,00% → 5,97%), tetapi besarannya harus diperbarui. Angka
0,656/0,748 hanya boleh dikutip dengan menyebut bahwa ia berasal dari putaran
kalibrasi pertama atas dataset yang berbeda.
