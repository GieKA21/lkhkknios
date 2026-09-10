# Intelligent Agent pada Verifikasi Wajah

Dokumen ini memformalkan komponen **Intelligent Agent** yang diminta pada
judul skripsi, dibatasi pada bagian **pengenalan wajah (face recognition)**.
Tujuannya: memberi rujukan yang bisa langsung dikutip di laporan, dan memetakan
setiap istilah agen ke kode nyata di repo ini.

> **Sifat komponen ini:** ia **tidak menambah perilaku baru**. Sistem
> keputusan on-device yang sudah ada dibingkai ulang dengan kosakata agen
> (Russell & Norvig, *Artificial Intelligence: A Modern Approach*). Fungsi
> keputusannya dipisah sebagai unit eksplisit di `utils/verificationAgent.ts`.

## 1. Apa yang membuatnya sebuah *agen*

Menurut Russell & Norvig, **agen** adalah entitas yang **mengindra**
lingkungan melalui *sensor* dan **bertindak** atasnya melalui *aktuator* untuk
mencapai sebuah *tujuan*. Sistem verifikasi wajah aplikasi ini memenuhinya:

- ia **mengindra** wajah, pose kepala, dan kondisi melalui kamera + ML Kit;
- ia **bertindak** dengan memberi instruksi ke pengguna dan memutuskan
  menerima/menolak absen;
- ia mengejar **tujuan** yang jelas: meloloskan pemilik wajah yang hadir &
  hidup, menolak impostor dan upaya spoofing.

Yang membedakannya dari sekadar "fungsi cocokkan wajah" adalah **loop
tantangan keaktifan (liveness)**: agen tidak menilai satu gambar lalu selesai —
ia memberi perintah gerak, mengamati respons, dan menyesuaikan langkah
berikutnya. Itu perilaku *perceive → decide → act* yang berulang, ciri khas
agen.

## 2. Spesifikasi PEAS

| Elemen | Isi |
|---|---|
| **Performance** | True-accept tinggi (pemilik hadir & hidup lolos); false-accept rendah (impostor & spoofing foto/layar ditolak); friksi pengguna minimal. Diukur: FAR, FRR, akurasi, keberhasilan liveness. |
| **Environment** | Adegan selfie di depan kamera depan: manusia — atau foto/layar — dengan pencahayaan & pose beragam. **Sebagian teramati** (satu kamera, tanpa kedalaman), **dinamis** (subjek bergerak), **kontinu**, **sekuensial** (percept antar-frame saling terkait). |
| **Actuators** | Instruksi di layar (tantangan gerak liveness, panduan framing) dan **keputusan akhir**: membuka shutter → menyimpan/menolak absen. |
| **Sensors** | Frame kamera (VisionCamera); percept ML Kit: bounding box, landmark mata, sudut kepala (yaw/pitch/roll), ukuran wajah; serta **embedding 192-dimensi** MobileFaceNet dari foto still. |

## 3. Tipe agen

**Goal-based agent** dengan **sub-loop reaktif berstate**.

- Bukan *simple reflex agent*: ia menyimpan **state internal** (tahap tantangan
  liveness yang sedang berjalan, arah tolehan pertama) dan mengejar **tujuan**
  ("keaktifan terbukti" lalu "identitas cocok"), bukan sekadar memetakan
  percept→aksi seketika.
- Sub-loop liveness bersifat **reaktif**: pada tiap frame ia bereaksi terhadap
  sudut yaw dan memilih instruksi berikut.
- Keputusan identitas bersifat **goal-directed**: membandingkan embedding ke
  seluruh set terdaftar dan memutuskan berdasar ambang.

## 4. Arsitektur & alur keputusan

```
        ┌─────────────────────────── AGEN VERIFIKASI WAJAH ───────────────────────────┐
        │                                                                              │
 kamera │  (1) PERSEPSI real-time            (2) SUB-AGEN LIVENESS (reaktif+state)      │
  ────► │  useFaceQualityGate                useLivenessChallenge                       │
        │  • wajah tunggal?                  • indra: yaw                               │
        │  • ukuran cukup?                   • state: tahap tantangan, tanda tolehan    │
        │  • pose lurus?                     • aksi: instruksi "toleh sisi lain"        │
        │        │                           • goal: dua tolehan berlawanan → passed    │
        │        └──────────► shutter TERKUNCI sampai liveness "passed" ◄───────┘       │
        │                                        │                                     │
        │                                        ▼ (jepret foto still)                 │
        │  (3) PERSEPSI still + KEPUTUSAN                                               │
        │  getFaceEmbedding  →  embedding 192-d                                         │
        │  decideAttendance  →  median-of-N similarity vs ambang 0.47                   │
        │        │                                                                     │
        │        ▼ aktuator                                                            │
        │   accepted → simpan absen   |   rejected → tolak   |   not-enrolled → daftar  │
        └──────────────────────────────────────────────────────────────────────────────┘
```

## 5. Pemetaan ke kode

| Bagian agen | Berkas / fungsi |
|---|---|
| Persepsi real-time (kualitas framing) | `hooks/useFaceQualityGate.ts` |
| Sub-agen liveness (loop reaktif berstate) | `hooks/useLivenessChallenge.ts` |
| Persepsi still → embedding | `getFaceEmbedding()` di `utils/faceAuthNative.ts` |
| **Fungsi keputusan agen** | `decideAttendance()` di `utils/verificationAgent.ts` |
| Metrik keputusan (median-of-N) | `similarityToEnrollment()` di `utils/faceEnrollment.ts` |
| Aktuator (instruksi + verdict UI) | `takeSelfie()` & modal kamera di `components/LKHScreen.tsx` |

## 6. Di mana "kecerdasan"-nya

Tiga lapis, semuanya sudah ada di aplikasi:

1. **Persepsi berbasis deep learning.** Wajah diubah jadi embedding oleh
   MobileFaceNet (CNN) — bukan pencocokan piksel, melainkan representasi
   ruang-fitur hasil pelatihan.
2. **Pengambilan keputusan berstate & bertujuan.** Agen menggabungkan
   beberapa percept (kualitas, keaktifan, kemiripan) menuju satu putusan,
   dengan strategi agregasi median yang dipilih lewat kalibrasi
   (`tools/face-calibration/`).
3. **Interaksi challenge–response.** Agen aktif menantang lingkungan (perintah
   gerak) dan menilai respons — inti anti-spoofing.

## 7. Batasan (disebutkan jujur)

- Sub-agen liveness menghentikan **foto/layar statis**, **bukan** pemutaran
  **video** wajah yang menoleh. Menahan video butuh model anti-spoof pasif
  (analisis tekstur/moire) — di luar cakupan versi ini.
- Verifikasi identitas berbasis **satu foto still**; tidak ada fusi
  multi-frame untuk identitas (hanya untuk liveness).
- Lingkungan **sebagian teramati** (tanpa data kedalaman/TrueDepth).

## 8. Cara mengukur agen (untuk bab pengujian)

Karena judul memuat "Intelligent Agent", evaluasi sebaiknya memuat minimal
satu dimensi yang menguji agennya, bukan hanya akurasi wajah:

- **Efektivitas liveness / anti-spoofing:** tingkat penolakan terhadap
  serangan foto & layar vs tingkat penerimaan wajah asli.
- **Keberhasilan & waktu penyelesaian tantangan:** berapa lama pengguna sah
  menuntaskan dua tolehan; berapa persen gagal karena pencahayaan/pose.
- Dimensi identitas (akurasi, FAR/FRR, waktu verifikasi) melengkapi, tetapi
  bukan pengganti pengukuran agen di atas.
