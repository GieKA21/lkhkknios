import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import type { Face } from "react-native-vision-camera-face-detector";
import { MIN_FACE_SIZE_RATIO } from "../utils/faceAuthNative";

/**
 * SUB-AGEN LIVENESS dari agen verifikasi wajah (lihat
 * utils/verificationAgent.ts untuk PEAS lengkap). Ini bagian yang paling
 * "agen": bukan sekali jalan, melainkan loop reaktif-berstate - mengindra
 * sudut kepala (yaw), MEMILIH instruksi berikutnya dari state internal
 * (tolehan pertama beserta tandanya), lalu bertindak (menampilkan instruksi),
 * berulang sampai mencapai goal "passed".
 *
 * Deteksi keaktifan berbasis TANTANGAN GERAK, untuk mencegah titip-absen
 * dengan foto/layar.
 *
 * MASALAH YANG DITUTUP: verifikasi wajah hanya menjawab "apakah ini wajah
 * yang benar?", bukan "apakah wajah HIDUP yang hadir sekarang?". Foto statis
 * milik orang terdaftar yang dihadapkan ke kamera lolos begitu saja - sudah
 * diuji dan memang berhasil. Tantangan gerak menuntut sesuatu yang foto
 * statis tidak bisa lakukan: menoleh ke dua sisi berlawanan atas perintah.
 *
 * KENAPA GERAK KEPALA, BUKAN KEDIP. Deteksi kedip butuh probabilitas mata,
 * yang hanya muncul saat `runClassifications` menyala di stream live. Kamera
 * live di aplikasi ini sengaja mematikannya (workaround crash SIGSEGV saat
 * kamera dibuka - lihat komentar di LKHScreen). Sudut `yawAngle` tetap
 * tersedia tanpa mode itu - quality gate live sudah membacanya dan terbukti
 * jalan - jadi head-turn menutup serangan tanpa menyalakan ulang mode yang
 * bikin crash.
 *
 * ===========================================================================
 * FASE PENGIKATAN IDENTITAS (ditambahkan 6 Oktober 2026)
 * ===========================================================================
 *
 * SERANGAN YANG DITUTUP - ditemukan oleh peneliti sendiri, bukan hipotetis.
 * Sebelum ini, tantangan gerak hanya membuka KUNCI TOMBOL, lalu identitas
 * diperiksa pada foto yang dijepret sesudahnya. Keduanya masukan yang
 * berbeda pada waktu yang berbeda, dan tidak ada yang mengikatnya. Akibatnya:
 *
 *   1. Teman masuk memakai akun korban.
 *   2. Teman menyelesaikan tantangan DENGAN WAJAHNYA SENDIRI - identitas
 *      tidak diperiksa sama sekali selama tantangan.
 *   3. Status lulus TERKUNCI: `if (phaseRef.current === "passed") return;`
 *      membuat hook berhenti membaca frame, jadi lulusnya tidak pernah batal.
 *   4. Teman menyodorkan HP kedua berisi foto korban, lalu menekan shutter.
 *   5. Embedding foto itu cocok dengan set terdaftar korban -> DITERIMA.
 *
 * Serangan ini bahkan tidak butuh video: manusia hidup yang menoleh, lalu
 * foto DIAM saat menjepret.
 *
 * CARA MENUTUPNYA: identitas sekarang diperiksa DI DALAM tantangan. Setelah
 * tolehan kedua, pengguna diminta menghadap tengah sekali lagi; pada saat itu
 * satu foto diambil diam-diam dan dicocokkan terhadap set wajah terdaftar.
 * Tantangan hanya dinyatakan lulus bila wajah yang mengerjakannya memang
 * pemilik akun. Wajah teman gugur di langkah ini dan tidak pernah sampai ke
 * tombol shutter.
 *
 * KENAPA FASE TENGAH TAMBAHAN, BUKAN MENJEPRET SAAT TOLEHAN KEDUA. Pada saat
 * tolehan kedua kepala sedang menoleh >= TURN_DEG, dan penyelarasan kanonik
 * menurun mutunya pada sudut sebesar itu - embedding-nya melemah dan pemilik
 * yang sah berpeluang ditolak. Menghadap tengah lebih dahulu memberi wajah
 * frontal, yaitu bentuk masukan yang memang dilatihkan ke model.
 *
 * BIAYA YANG DISADARI: satu jepretan + satu inferensi tambahan per percobaan
 * absen. Catatan di LKHScreen memperingatkan bahwa menjalankan model
 * BERULANG-ULANG selama preview hidup memicu force close di sebagian HP;
 * yang ditambahkan di sini dijalankan SEKALI pada satu titik, setara dengan
 * yang sudah dilakukan takeSelfie, bukan per frame.
 *
 * BATAS YANG MASIH DIAKUI: ini tetap tidak menahan PEMUTARAN VIDEO wajah
 * pemilik yang sedang menoleh - video bisa lolos tantangan sekaligus
 * pemeriksaan identitas. Menahannya butuh model anti-spoof pasif
 * (analisis tekstur/moire), di luar cakupan tantangan gerak.
 *
 * BATAS KEDUA, DITAMBAHKAN SADAR PADA 18 OKTOBER 2026: sesudah lulus, wajah
 * boleh hilang sampai ~2 detik tanpa membatalkan kelulusan (lihat
 * MAKS_TICK_HILANG_LULUS). Batas lama 0,55 detik menolak pengguna sah yang
 * sekadar menunduk mencari tombol rana - dilaporkan dari perangkat pada iOS
 * maupun Android. Pertukarannya nyata: jendela untuk menyodorkan foto
 * pemilik akun sesudah identitas terbukti ikut melebar menjadi ~2 detik.
 * Jadi serangan tukar wajah pada daftar di atas TIDAK tertutup rapat - ia
 * dipersempit oleh pemeriksaan identitas di dalam tantangan, bukan
 * dihilangkan. Naskah harus menyatakannya apa adanya.
 *
 * SIGN-CONVENTION AMAN: arah yaw positif/negatif bergantung konvensi ML Kit +
 * mirror kamera depan, yang tidak bisa diverifikasi tanpa perangkat. Maka
 * tantangan ini TIDAK memberi label kiri/kanan yang bisa salah: cukup "toleh
 * ke satu sisi", lalu "toleh ke sisi sebaliknya" - diterima arah mana pun
 * asal keduanya berlawanan dan melewati tengah. Tetap mustahil dipenuhi foto
 * diam, dan tidak bisa menyesatkan pengguna ke arah yang keliru.
 */

// Ambang magnitudo yaw untuk dihitung sebagai "menoleh". Di bawah MAX_YAW_DEG
// (25, batas quality gate saat menjepret), jadi setelah lolos tantangan
// pengguna cukup menghadap tengah lagi untuk mengambil foto.
const TURN_DEG = 20;
// Harus kembali ke dalam rentang ini sebelum tolehan kedua dihitung -
// membuktikan gerakan nyata bolak-balik, bukan satu pose yang ditahan.
const CENTER_DEG = 10;
// Berapa kali mutu foto pengikatan boleh gagal (mata terpejam, wajah blur)
// sebelum tantangan diulang dari awal. Kegagalan MUTU bukan kegagalan
// identitas, jadi tidak adil kalau langsung mengulang semuanya.
const MAKS_ULANG_MUTU = 1;

/**
 * Berapa tick berturut-turut wajah harus sudah menghadap tengah sebelum foto
 * pengikatan diambil.
 *
 * Menjepret pada tick pertama yang kebetulan lolos ambang berarti menangkap
 * wajah yang masih bergerak - hasilnya buram, mutunya gagal, dan satu
 * jepretan beserta satu inferensi terbuang percuma. Menunggu beberapa tick
 * jauh lebih murah daripada mengulang keduanya. Pada FACE_TICK_MS=110 di
 * LKHScreen, 3 tick kira-kira 0,33 detik - tidak terasa lambat bagi pengguna.
 */
const TICK_TENGAH_MANTAP = 3;

/**
 * Lama penutup layar ditahan setelah foto pengikatan diambil, menunggu
 * pengukuran pencahayaan iOS kembali mantap. Lihat alasan lengkapnya di
 * jalankanPengikatan. 450 ms cukup untuk satu putaran pengukuran ulang dan
 * masih terasa seketika bagi pengguna.
 */
const PEMULIHAN_CAHAYA_MS = 450;

// ===========================================================================
// TANTANGAN ACAK - penahan pemutaran video
// ===========================================================================
//
// Pengujian perangkat 7 Oktober 2026 memastikan dua hal sekaligus: penyodoran
// foto sudah tertahan, tetapi PEMUTARAN VIDEO wajah pemilik yang sedang
// menoleh masih lolos. Sebabnya urutan tantangan dahulu TETAP - satu tolehan
// ke sembarang sisi, lalu satu tolehan ke sisi sebaliknya - sehingga satu
// rekaman berisi gerakan itu akan selalu cocok.
//
// YANG MEMBUAT REKAMAN GAGAL: tantangan yang baru diundi pada saat itu juga.
// Rekaman dibuat sebelum tantangannya ada, jadi polanya sudah terkunci dan
// tidak bisa menyesuaikan diri.
//
// MASALAH YANG HARUS DILALUI. Melabeli arah sebagai "kiri" atau "kanan"
// menuntut kepastian tanda yaw di bawah pencerminan kamera depan, dan itu
// tidak dapat dipastikan tanpa pengukuran di perangkat - alasan yang sama
// yang dulu membuat tantangan ini sengaja tidak berlabel.
//
// JALAN KELUARNYA: arah dilabeli secara RELATIF, bukan mutlak. Tolehan
// pertama bebas ke sisi mana pun, dan aplikasi mencatat tandanya. Tolehan
// berikutnya diminta "ke sisi yang sama" atau "ke sisi sebaliknya" terhadap
// tolehan sebelumnya. Pengguna memahaminya tanpa perlu tahu kiri atau kanan,
// aplikasi memeriksanya hanya dari perbandingan tanda, dan rekaman tetap
// tidak bisa mengikutinya.
//
// Dengan tiga sampai empat tolehan, arah tolehan kedua dan seterusnya diundi
// bebas, sehingga satu rekaman berpola tetap hanya cocok pada sebagian kecil
// kemungkinan.
//
// JUJUR TENTANG BATASNYA: ini menaikkan ongkos serangan, bukan menghapusnya.
// Penyerang yang menyiapkan rekaman untuk setiap kemungkinan, atau memakai
// pemalsuan wajah waktu-nyata, tetap dapat menembus. Yang benar-benar
// menutupnya hanya model anti-spoof pasif - analisis tekstur dan moire layar -
// dan itu di luar cakupan tantangan gerak.

/** Jumlah tolehan paling sedikit dan paling banyak dalam satu tantangan.
 *  Tiga sudah membuat rekaman berpola tetap sering meleset; lebih dari empat
 *  mulai melelahkan pengguna yang sah. */
const MIN_TOLEHAN = 3;
const MAKS_TOLEHAN = 4;

/** Batas waktu menjawab SATU perintah, sejak perintahnya muncul.
 *
 *  Selain menyulitkan rekaman yang berjalan menurut jadwalnya sendiri, ini
 *  juga menutup tantangan yang ditinggal pengguna separuh jalan.
 *
 *  BELUM DIUKUR DI PERANGKAT. Dipasang longgar supaya pengguna yang membaca
 *  perintahnya pelan-pelan tidak ikut tergugurkan; dapat diperketat setelah
 *  ada data dari pengujian sungguhan. */
const BATAS_WAKTU_PERINTAH_MS = 7000;

/** Batas waktu satu pemeriksaan identitas.
 *
 *  Longgar dengan sengaja: pemakaian pertama sesudah pemasangan harus
 *  menanggung penyiapan modul asli, dan menggugurkannya terlalu cepat hanya
 *  memindahkan kegagalan, bukan menghilangkannya. Yang dicegah di sini
 *  adalah penantian TANPA UJUNG, bukan penantian yang lama. */
const BATAS_WAKTU_PENGIKATAN_MS = 12000;

/** Arah tolehan yang diminta, relatif terhadap tolehan sebelumnya. */
type ArahDiminta = "sama" | "lawan";

/** Mengundi rencana tantangan untuk satu sesi.
 *  Keluarannya arah untuk tolehan KEDUA dan seterusnya; tolehan pertama
 *  selalu bebas karena belum ada acuan untuk dibandingkan. */
function undiRencana(): ArahDiminta[] {
  const jumlah =
    MIN_TOLEHAN + Math.floor(Math.random() * (MAKS_TOLEHAN - MIN_TOLEHAN + 1));
  return Array.from({ length: jumlah - 1 }, () =>
    Math.random() < 0.5 ? "sama" : "lawan",
  );
}

// ===========================================================================
// PANAH ARAH - hanya tampilan, pemeriksaannya tetap relatif
// ===========================================================================
//
// Dosen pembimbing menilai instruksi absen terlalu kecil, dan perintah "sisi
// yang SAMA / SEBALIKNYA" menuntut pengguna mengingat tolehan sebelumnya
// sambil menoleh. Panah di samping wajah menunjukkan sisinya langsung.
//
// Rencana dan pemeriksaan TIDAK berubah: rencana tetap diundi relatif, dan
// tolehan tetap dinilai dari perbandingan tanda yaw. Panah hanya
// menerjemahkan tanda yang DIHARAPKAN menjadi sisi layar. Sisi layar sama
// dengan sisi tubuh pengguna karena layar menghadap pengguna, apa pun
// pencerminan pratinjaunya.
//
// Yang belum diketahui hanyalah arti tanda yaw itu sendiri pada tiap
// platform - lihat catatan SIGN-CONVENTION di atas. Karena itu nilainya
// diisi dari PENGUKURAN DI PERANGKAT, bukan tebakan: penguji menoleh ke kanan
// dirinya sendiri dengan TAMPILKAN_YAW menyala (LKHScreen), lalu mencatat
// tanda yaw yang tampil. null = belum diukur: panah tidak ditampilkan dan
// instruksi kembali ke teks relatif, jadi build yang belum diukur tetap
// tidak pernah menunjuk arah yang keliru.

/** Sisi tubuh pengguna saat yaw bernilai positif, per platform. */
const SISI_YAW_POSITIF: Record<string, "kiri" | "kanan" | null> = {
  // Diukur 4 November 2026, iPhone 16 (build61 cabang uji/tanda-yaw): menoleh
  // ke kanan memberi yaw positif (+16, +23), dan tantangan lulus dengan
  // mengikuti panah.
  ios: "kanan",
  android: null,
};

const SISI_POSITIF_PLATFORM = SISI_YAW_POSITIF[Platform.OS] ?? null;

/** Ke sisi mana panah menunjuk; "keduanya" untuk tolehan pertama yang bebas. */
export type ArahPanah = "kiri" | "kanan" | "keduanya";

function sisiDariTanda(tanda: -1 | 1): "kiri" | "kanan" | null {
  if (!SISI_POSITIF_PLATFORM) return null;
  if (tanda === 1) return SISI_POSITIF_PLATFORM;
  return SISI_POSITIF_PLATFORM === "kanan" ? "kiri" : "kanan";
}

// ===========================================================================
// PENJAGA KESINAMBUNGAN WAJAH
// ===========================================================================
//
// Memeriksa identitas pada SATU titik waktu saja tidak cukup, dan ini perlu
// dicatat karena mudah terlewat: penyerang cukup menyodorkan foto korban
// tepat pada saat pemeriksaan itu berlangsung. Tolehannya dikerjakan wajah
// sendiri, fotonya disodorkan hanya pada detik pengikatan.
//
// Maka pengikatan identitas HARUS disertai bukti bahwa wajah yang sama hadir
// TERUS-MENERUS sejak tantangan dimulai sampai foto absen diambil. Penjaga di
// bawah ini mencarinya dari geometri kotak wajah antar-frame - tanpa
// inferensi tambahan, jadi tidak membebani seperti menjalankan model per
// frame (penyebab force close yang dicatat di LKHScreen).
//
// Menukar wajah dengan layar HP meninggalkan dua jejak yang terukur:
// wajahnya menghilang sejenak saat tangan bergerak, dan kotak wajahnya
// melompat dalam ukuran maupun posisi. Keduanya dijaga di sini.
//
// ANGKA-ANGKA DI BAWAH BELUM DIUKUR DI PERANGKAT. Keduanya sengaja dipasang
// longgar supaya pengguna sah tidak ikut tertolak; mengetatkannya menuntut
// pengujian pada iOS dan Android lebih dahulu.

/** Berapa tick berturut-turut wajah boleh hilang sebelum tantangan batal.
 *  Pada FACE_TICK_MS=110 di LKHScreen, 5 tick kira-kira 0,55 detik - lebih
 *  lama dari kedipan detektor saat kepala menoleh cepat, lebih singkat dari
 *  gerakan tangan menukar perangkat. */
const MAKS_TICK_HILANG = 5;

/** Batas yang sama, tetapi HANYA sesudah tantangan lulus: 18 tick pada
 *  FACE_TICK_MS=110 kira-kira 2 detik.
 *
 *  SEBABNYA DILAPORKAN DARI PERANGKAT (18 Oktober 2026, iOS dan Android).
 *  Pengguna menyelesaikan seluruh tolehan, identitasnya terbukti, lalu
 *  menunduk sebentar mencari tombol rana - wajahnya hilang dari bingkai
 *  kurang dari satu detik, penjaga di bawah membatalkan kelulusan, dan
 *  tantangan diundi ulang dari nol. 0,55 detik jauh di bawah waktu manusia
 *  memindahkan pandangan ke sebuah tombol, jadi batas lama praktis mustahil
 *  dilewati pengguna sah yang memakai shutter.
 *
 *  HARGANYA, DAN INI HARUS JUJUR DICATAT DI NASKAH: jendela untuk menukar
 *  wajah sesudah identitas terbukti ikut melebar dari ~0,55 detik menjadi
 *  ~2 detik. Dua detik cukup untuk mengangkat foto pemilik akun ke depan
 *  kamera. Serangan tukar wajah memang sudah tercatat terbuka pada naskah;
 *  perubahan ini MEMPERLEBARNYA, bukan menutupnya. Dipilih sadar oleh
 *  peneliti sebagai pertukaran demi kebergunaan.
 *
 *  Selama tantangan belum lulus, batasnya TIDAK dilonggarkan sedikit pun -
 *  di fase itu pengguna memang sedang menatap kamera. */
const MAKS_TICK_HILANG_LULUS = 18;

/** Berapa bingkai hilang yang ditelan diam-diam sebelum perintahnya diganti
 *  "Posisikan wajah dalam bingkai". Menahan kedipan pencahayaan iPhone agar
 *  tidak menghapus perintah tolehan yang sedang dikerjakan pengguna. Lebih
 *  kecil daripada MAKS_TICK_HILANG, sehingga keluhan tetap sempat muncul
 *  sebelum tantangan benar-benar diulang. */
const TICK_SEBELUM_KELUHAN = 2;
/** Lompatan posisi titik tengah wajah antar-tick, sebagai pecahan lebar
 *  frame. Gerak kepala yang wajar jauh di bawah ini. */
const MAKS_LOMPAT_POSISI = 0.35;
/** Perubahan lebar kotak wajah antar-tick, sebagai pecahan lebar sebelumnya.
 *  Mendekat/menjauh secara wajar tidak sampai sebesar ini dalam satu tick. */
const MAKS_UBAH_UKURAN = 0.45;

type KotakWajah = { cx: number; cy: number; w: number; frameW: number };

/**
 * Apakah kotak wajah sekarang masih mungkin merupakan wajah yang sama dengan
 * kotak sebelumnya?
 *
 * `kelonggaran` adalah jumlah tick yang terlewat ditambah satu. Semakin lama
 * wajah tidak terbaca, semakin jauh ia wajar berpindah, jadi ambangnya ikut
 * melebar - alih-alih mematikan pemeriksaan sama sekali selama wajah sempat
 * hilang, yang justru akan menyisakan celah menukar wajah dalam sekejap.
 */
function masihSinambung(
  lama: KotakWajah,
  baru: KotakWajah,
  kelonggaran: number,
): boolean {
  if (lama.frameW !== baru.frameW) return true; // orientasi berubah, jangan menuduh
  const lompat = Math.hypot(baru.cx - lama.cx, baru.cy - lama.cy) / baru.frameW;
  if (lompat > MAKS_LOMPAT_POSISI * kelonggaran) return false;
  const ubah = Math.abs(baru.w - lama.w) / Math.max(lama.w, 1);
  return ubah <= MAKS_UBAH_UKURAN * kelonggaran;
}

/**
 * Hasil pemeriksaan identitas pada fase pengikatan:
 *   "ok"     - wajah pengerjanya memang pemilik akun, tantangan lulus
 *   "ulangi" - fotonya tidak terbaca (mutu), minta hadap tengah lagi
 *   "gagal"  - wajahnya BUKAN pemilik akun, tantangan diulang dari awal
 */
export type HasilPengikatan = "ok" | "ulangi" | "gagal";

type Phase = "turn" | "center" | "confirm-center" | "binding" | "passed";

/** Baris utama tiap pesan. Sengaja pendek: satu kalimat panjang pada pil
 *  sempit melipat jadi tiga baris dan tidak terbaca sambil menoleh.
 *  Keterangannya pindah ke SUB di bawah. */
const MSG = {
  frame: "Posisikan wajah dalam bingkai",
  near: "Dekatkan wajah ke kamera",
  first: "Toleh perlahan ke satu sisi",
  center: "Hadapkan lagi ke tengah",
  sama: "Toleh lagi ke sisi yang SAMA",
  lawan: "Toleh ke sisi SEBALIKNYA",
  // Pengganti sama/lawan bila panah tampil - lihat SISI_YAW_POSITIF.
  panah: "Toleh ke arah panah",
  confirm: "Hadapkan wajah lurus ke kamera",
  binding: "Memeriksa identitas",
  ulangi: "Hadapkan lurus sekali lagi",
  putus: "Wajah sempat hilang",
  lambat: "Terlalu lama",
  pengikatanLambat: "Pemeriksaan terlalu lama",
  passed: "Deteksi aktif berhasil",
} as const;

/** Baris kedua: keterangan kecil di bawah baris utama. Boleh kosong. */
const SUB: Record<string, string> = {
  [MSG.frame]: "Pastikan wajah terlihat utuh",
  [MSG.near]: "Kira-kira sejengkal dari layar",
  [MSG.first]: "Tahan sebentar sampai terdeteksi",
  [MSG.center]: "Lalu tunggu perintah berikutnya",
  [MSG.sama]: "Tahan sebentar sampai terdeteksi",
  [MSG.lawan]: "Tahan sebentar sampai terdeteksi",
  [MSG.panah]: "Tahan sebentar sampai terdeteksi",
  [MSG.confirm]: "Tahan sampai pemeriksaan selesai",
  [MSG.binding]: "Jangan gerakkan perangkat dulu",
  [MSG.ulangi]: "Wajah kurang jelas saat diperiksa",
  [MSG.putus]: "Tantangan diulang dari tolehan pertama",
  [MSG.lambat]: "Tantangan diulang dari tolehan pertama",
  [MSG.pengikatanLambat]: "Coba sekali lagi, biasanya lancar",
  [MSG.passed]: "Silakan ambil foto presensi",
};

export type NadaPesan = "netral" | "peringatan" | "lolos";

const NADA: Record<string, NadaPesan> = {
  [MSG.ulangi]: "peringatan",
  [MSG.putus]: "peringatan",
  [MSG.lambat]: "peringatan",
  [MSG.pengikatanLambat]: "peringatan",
  [MSG.passed]: "lolos",
};

/** Berapa lama pesan peringatan ditahan sebelum boleh ditimpa.
 *
 *  TANPA INI PESANNYA TIDAK TERBACA. resetDenganPesan menulis pesannya, lalu
 *  bingkai kamera berikutnya - sepersekian detik kemudian - menimpanya dengan
 *  instruksi biasa. Pengguna hanya melihat kedipan. Dilaporkan dari pengujian
 *  perangkat nyata: "ada tapi singkat banget". */
const TAHAN_PESAN_MS = 2000;

/** Pesan yang ditahan, dan pesan yang boleh menerobos penahanan. */
const DITAHAN: readonly string[] = [
  MSG.ulangi, MSG.putus, MSG.lambat, MSG.pengikatanLambat,
];
const MENDESAK: readonly string[] = [MSG.binding, MSG.passed];

export function useLivenessChallenge(
  onBind?: () => Promise<HasilPengikatan>,
) {
  // State mesin disimpan di ref, bukan useState: onFacesDetected dipanggil
  // per frame dan harus stabil (tidak dibuat ulang tiap render), jadi ia
  // tidak boleh menutup nilai state yang bisa basi. useState hanya untuk
  // nilai yang benar-benar dirender.
  const phaseRef = useRef<Phase>("turn");
  const ulangMutuRef = useRef(0);
  // Rencana tantangan sesi ini, diundi ulang tiap kali tantangan dimulai.
  const rencanaRef = useRef<ArahDiminta[]>(undiRencana());
  // Berapa tolehan yang sudah sah dikerjakan, dan ke arah mana yang terakhir.
  const tolehanKeRef = useRef(0);
  const tandaTerakhirRef = useRef<-1 | 1>(1);
  // Kapan perintah yang sedang berjalan ditampilkan - dasar batas waktu.
  const perintahSejakRef = useRef(Date.now());
  // Penjaga kesinambungan: kotak wajah pada tick sebelumnya, dan berapa tick
  // berturut-turut wajah tidak terbaca.
  const kotakRef = useRef<KotakWajah | null>(null);
  const tickHilangRef = useRef(0);
  // Berapa tick berturut-turut wajah sudah menghadap tengah pada fase
  // confirm-center - lihat TICK_TENGAH_MANTAP.
  const tickTengahRef = useRef(0);
  // onBind disimpan di ref dengan alasan yang sama: onFacesDetected
  // di-useCallback([]) supaya referensinya stabil (sesi kamera dikonfigurasi
  // ulang kalau berubah - lihat catatan "preview hitam" di LKHScreen), jadi
  // ia tidak boleh menutup callback yang dibuat ulang tiap render.
  const onBindRef = useRef(onBind);
  onBindRef.current = onBind;

  const [passed, setPassed] = useState(false);
  const [instruction, setInstruction] = useState<string>(MSG.first);
  const [step, setStep] = useState(0);
  const [total, setTotal] = useState(rencanaRef.current.length + 2);
  const [isBinding, setIsBinding] = useState(false);
  // Sisi yang ditunjuk panah untuk perintah tolehan terakhir. Hanya
  // ditampilkan selama perintah tolehan itu sendiri yang tampil - lihat
  // arahPanah pada nilai kembalian.
  const [arahTolehan, setArahTolehan] = useState<ArahPanah | null>(
    SISI_POSITIF_PLATFORM ? "keduanya" : null,
  );

  /** Sampai kapan pesan peringatan yang sedang tampil tidak boleh ditimpa. */
  const tahanSampaiRef = useRef(0);

  /** Satu-satunya jalan menulis instruksi ke layar.
   *
   *  Peringatan selalu lolos dan membuka jendela penahanan; instruksi biasa
   *  ditolak selama jendela itu terbuka. Tanpa penahanan ini, peringatan
   *  ditimpa bingkai kamera berikutnya dan tidak sempat terbaca. */
  const tampilkan = useCallback((pesan: string) => {
    const kini = Date.now();
    if (MENDESAK.includes(pesan)) {
      tahanSampaiRef.current = 0;
      setInstruction(pesan);
      return;
    }
    if (DITAHAN.includes(pesan)) {
      tahanSampaiRef.current = kini + TAHAN_PESAN_MS;
      setInstruction(pesan);
      return;
    }
    if (kini < tahanSampaiRef.current) return;
    setInstruction(pesan);
  }, []);

  /** Mulai dari nol dengan pesan tertentu, DAN mengundi rencana baru.
   *
   *  Pengundian ulang di sini disengaja: percobaan yang gagal lalu dimulai
   *  lagi harus memperoleh tantangan yang berbeda. Kalau rencananya tetap,
   *  penyerang cukup mengulang sampai rekamannya kebetulan cocok. */
  const resetDenganPesan = useCallback((pesan: string) => {
    // Satu baris diagnostik. Tanpa ini, "kok disuruh ulang" hanya bisa
    // ditebak: ada empat sebab berbeda yang semuanya berakhir di sini, dan
    // layar hanya memperlihatkan instruksinya, bukan alasannya.
    console.log(
      `[Liveness] tantangan diulang - sebab="${pesan}" fase=${phaseRef.current} tickHilang=${tickHilangRef.current}`,
    );
    rencanaRef.current = undiRencana();
    phaseRef.current = "turn";
    tolehanKeRef.current = 0;
    tandaTerakhirRef.current = 1;
    perintahSejakRef.current = Date.now();
    ulangMutuRef.current = 0;
    kotakRef.current = null;
    tickHilangRef.current = 0;
    tickTengahRef.current = 0;
    setPassed(false);
    setStep(0);
    setTotal(rencanaRef.current.length + 2);
    setIsBinding(false);
    setArahTolehan(SISI_POSITIF_PLATFORM ? "keduanya" : null);
    tampilkan(pesan);
  }, [tampilkan]);

  const reset = useCallback(() => {
    resetDenganPesan(MSG.first);
  }, [resetDenganPesan]);

  const jalankanPengikatan = useCallback(async () => {
    const bind = onBindRef.current;
    // Tanpa callback pengikatan, tantangan dinyatakan lulus begitu seluruh
    // tolehan selesai. Sengaja TIDAK menolak diam-diam, supaya pemanggil
    // yang lupa memasang onBind tidak mengunci penggunanya.
    if (!bind) {
      phaseRef.current = "passed";
      setStep(rencanaRef.current.length + 2);
      setPassed(true);
      tampilkan(MSG.passed);
      return;
    }
    setIsBinding(true);
    tampilkan(MSG.binding);
    // "lambat" hanya dipakai di dalam fungsi ini; HasilPengikatan yang
    // dilihat pemanggil sengaja tidak ikut berubah.
    let hasil: HasilPengikatan | "lambat";
    try {
      // BATAS WAKTU - tanpa ini layar bisa menggantung selamanya.
      //
      // bind() memotret, mengenali wajah, menghitung embedding, lalu
      // membandingkannya. Kalau satu saja dari langkah itu tidak pernah
      // selesai - kamera belum siap, modul asli masih disiapkan sesudah
      // pemasangan, jaringan menggantung - setIsBinding(false) tidak pernah
      // tercapai dan penutup "Memeriksa identitas" menetap. Satu-satunya
      // jalan keluar bagi pengguna adalah menutup aplikasi. Dilaporkan dari
      // perangkat pada 9 Oktober 2026.
      //
      // Lewat batas ini, tantangan diulang alih-alih menggantung. Percobaan
      // berikutnya umumnya lancar karena biaya penyiapannya sudah terbayar.
      hasil = await Promise.race<HasilPengikatan | "lambat">([
        bind(),
        new Promise<"lambat">((lanjut) =>
          setTimeout(() => lanjut("lambat"), BATAS_WAKTU_PENGIKATAN_MS),
        ),
      ]);
    } catch {
      hasil = "ulangi";
    }
    if (hasil === "lambat") {
      // Jangan pakai pesan "ulangi" yang biasa: sebabnya bukan mutu wajah,
      // dan pengguna perlu tahu bahwa mengulang memang menolong.
      setIsBinding(false);
      kotakRef.current = null;
      tickHilangRef.current = 0;
      resetDenganPesan(MSG.pengikatanLambat);
      return;
    }
    // JEDA PEMULIHAN PENCAHAYAAN - jangan dihapus tanpa membaca ini.
    //
    // Mengambil foto diam membuat iOS mengukur ulang pencahayaan, dan selama
    // pengukuran itu preview meredup beberapa bingkai lalu pulih. Gejalanya
    // sudah pernah tercatat di proyek ini ("pratinjau kamera gelap dan
    // berkedip") dan lebih kentara di sini karena saat detektor wajah aktif
    // iOS membatasi exposure ke satu durasi bingkai - lihat cameraConstraints
    // di LKHScreen.
    //
    // Akibatnya bukan sekadar enak atau tidak dipandang: bila pengguna
    // menekan shutter tepat pada bingkai-bingkai redup itu, foto absennya
    // ikut gelap, mutunya gagal, dan verifikasinya ditolak. Karena itu
    // penutup layar DAN kuncian shutter sengaja ditahan sebentar sampai
    // pencahayaan kembali mantap.
    await new Promise((lanjut) => setTimeout(lanjut, PEMULIHAN_CAHAYA_MS));
    setIsBinding(false);
    // Frame diabaikan selama pengikatan, jadi kotak terakhir sudah basi -
    // tanpa dikosongkan, tick pertama sesudah ini akan terbaca sebagai
    // lompatan dan membatalkan tantangan yang justru baru saja lulus.
    kotakRef.current = null;
    tickHilangRef.current = 0;

    if (hasil === "ok") {
      phaseRef.current = "passed";
      setStep(rencanaRef.current.length + 2);
      setPassed(true);
      tampilkan(MSG.passed);
      return;
    }
    if (hasil === "ulangi" && ulangMutuRef.current < MAKS_ULANG_MUTU) {
      ulangMutuRef.current += 1;
      phaseRef.current = "confirm-center";
      tickTengahRef.current = 0;
      tampilkan(MSG.ulangi);
      return;
    }
    // Identitas tidak cocok, atau mutu gagal terus - ulang dari awal.
    // Pesannya ditentukan pemanggil lewat Alert; di sini cukup instruksi.
    resetDenganPesan(MSG.first);
  }, [resetDenganPesan, tampilkan]);

  const onFacesDetected = useCallback(
    (faces: Face[]) => {
      // Selama pengikatan berjalan frame diabaikan: kamera sedang dipakai
      // mengambil foto pengikatan dan model sedang berjalan.
      if (phaseRef.current === "binding") return;

      const sudahLulus = phaseRef.current === "passed";

      // ---- penjaga kesinambungan, berlaku di SEMUA fase termasuk sesudah
      // lulus. Inilah yang membuat pengikatan identitas berarti: tanpa ini,
      // identitas yang diperiksa pada satu titik waktu bisa dipenuhi dengan
      // menyodorkan foto tepat pada titik itu.
      if (!faces || faces.length !== 1) {
        const pesan =
          !faces || faces.length === 0
            ? MSG.frame
            : "Terdeteksi lebih dari satu wajah";
        // Belum pernah ada wajah pada percobaan ini berarti pengguna memang
        // belum memposisikan diri - bukan wajah yang hilang. Tanpa pembedaan
        // ini, membuka kamera lalu diam sebentar sudah memunculkan tuduhan
        // "wajah sempat hilang" sebelum tantangan dimulai.
        // Jam batas waktu disetel ulang selama wajah belum terbaca. Tanpa ini,
        // pengguna yang lambat memposisikan diri sudah kehabisan waktu
        // sebelum sempat menoleh sekali pun - jam berjalan sejak perintahnya
        // muncul, bukan sejak wajahnya terlihat.
        perintahSejakRef.current = Date.now();
        if (kotakRef.current === null) {
          if (!sudahLulus) tampilkan(pesan);
          return;
        }
        tickHilangRef.current += 1;
        // Sesudah lulus batasnya lebih longgar - lihat MAKS_TICK_HILANG_LULUS
        // beserta catatan pertukaran keamanannya.
        const batasHilang = sudahLulus
          ? MAKS_TICK_HILANG_LULUS
          : MAKS_TICK_HILANG;
        if (tickHilangRef.current > batasHilang) {
          resetDenganPesan(MSG.putus);
          return;
        }
        // JANGAN ganti perintahnya pada kedipan pertama.
        //
        // Pada iPhone, pencahayaan preview sesekali anjlok beberapa bingkai
        // lalu pulih - lihat cameraConstraints di LKHScreen. Selama bingkai
        // gelap itu wajah tidak terdeteksi, dan dulu perintah tolehan langsung
        // tergantikan "Posisikan wajah dalam bingkai" lalu kembali lagi.
        // Pengguna membaca itu sebagai layar yang berkedip-kedip dan kehilangan
        // perintah yang sedang dikerjakannya.
        //
        // Hilangnya wajah tetap DIHITUNG seperti semula - hanya pengumumannya
        // yang ditahan sampai benar-benar berulang. Penjaga kesinambungan dan
        // batas MAKS_TICK_HILANG tidak dilonggarkan sedikit pun.
        if (!sudahLulus && tickHilangRef.current > TICK_SEBELUM_KELUHAN) {
          tampilkan(pesan);
        }
        return;
      }

      const face = faces[0];
      const kotak: KotakWajah = {
        cx: face.bounds.x + face.bounds.width / 2,
        cy: face.bounds.y + face.bounds.height / 2,
        w: face.bounds.width,
        frameW: face.frameWidth,
      };
      const sebelumnya = kotakRef.current;
      if (
        sebelumnya &&
        !masihSinambung(sebelumnya, kotak, 1 + tickHilangRef.current)
      ) {
        resetDenganPesan(MSG.putus);
        return;
      }
      kotakRef.current = kotak;
      tickHilangRef.current = 0;

      // Sesudah lulus, penjaga di atas tetap berjalan tetapi mesin tantangan
      // tidak lagi maju - tidak ada fase sesudah "passed".
      if (sudahLulus) return;

      if (face.bounds.width / face.frameWidth < MIN_FACE_SIZE_RATIO) {
        // Sama seperti saat wajah tidak terbaca: selama pengguna masih
        // terlalu jauh, perintahnya belum benar-benar bisa dikerjakan, jadi
        // jam batas waktunya belum boleh berjalan.
        perintahSejakRef.current = Date.now();
        tampilkan(MSG.near);
        return;
      }

      const yaw = face.yawAngle;

      // Batas waktu menjawab satu perintah. Selain menutup tantangan yang
      // ditinggal separuh jalan, ini menyulitkan rekaman video: rekaman
      // berjalan menurut jadwalnya sendiri dan harus kebetulan menoleh dalam
      // jendela waktu yang baru dibuka aplikasi.
      if (
        phaseRef.current !== "confirm-center" &&
        Date.now() - perintahSejakRef.current > BATAS_WAKTU_PERINTAH_MS
      ) {
        resetDenganPesan(MSG.lambat);
        return;
      }

      /** Tanda yaw yang diharapkan pada tolehan ke-n (n mulai dari 0);
       *  null untuk tolehan pertama, yang bebas. */
      const tandaDiharapkan = (n: number): -1 | 1 | null =>
        n === 0
          ? null
          : rencanaRef.current[n - 1] === "sama"
            ? tandaTerakhirRef.current
            : ((-tandaTerakhirRef.current) as -1 | 1);

      /** Menampilkan perintah untuk tolehan ke-n beserta panahnya. */
      const perintahkanTolehan = (n: number) => {
        const tanda = tandaDiharapkan(n);
        if (tanda === null) {
          setArahTolehan(SISI_POSITIF_PLATFORM ? "keduanya" : null);
          tampilkan(MSG.first);
          return;
        }
        const sisi = sisiDariTanda(tanda);
        setArahTolehan(sisi);
        tampilkan(
          sisi
            ? MSG.panah
            : rencanaRef.current[n - 1] === "sama"
              ? MSG.sama
              : MSG.lawan,
        );
      };

      switch (phaseRef.current) {
        case "turn": {
          if (Math.abs(yaw) < TURN_DEG) {
            perintahkanTolehan(tolehanKeRef.current);
            break;
          }
          const tanda: -1 | 1 = yaw >= 0 ? 1 : -1;
          const n = tolehanKeRef.current;

          // Tolehan pertama bebas - belum ada acuan pembanding. Sesudahnya
          // arahnya harus sesuai rencana yang diundi, RELATIF terhadap
          // tolehan sebelumnya.
          if (n > 0) {
            const diminta = rencanaRef.current[n - 1];
            const harusnya: -1 | 1 =
              diminta === "sama"
                ? tandaTerakhirRef.current
                : ((-tandaTerakhirRef.current) as -1 | 1);
            if (tanda !== harusnya) {
              // Menoleh ke sisi yang keliru bukan kecurangan, cuma salah
              // dengar - cukup diminta ulang, jangan membatalkan tantangan.
              perintahkanTolehan(n);
              break;
            }
          }

          tandaTerakhirRef.current = tanda;
          tolehanKeRef.current = n + 1;
          setStep(n + 1);
          perintahSejakRef.current = Date.now();

          if (tolehanKeRef.current > rencanaRef.current.length) {
            phaseRef.current = "confirm-center";
            tampilkan(MSG.confirm);
          } else {
            phaseRef.current = "center";
            tampilkan(MSG.center);
          }
          break;
        }

        case "center":
          if (Math.abs(yaw) <= CENTER_DEG) {
            phaseRef.current = "turn";
            perintahSejakRef.current = Date.now();
            perintahkanTolehan(tolehanKeRef.current);
          } else {
            tampilkan(MSG.center);
          }
          break;

        case "confirm-center":
          // Wajah sudah frontal lagi: inilah titik pengikatan identitas.
          // Ditunggu beberapa tick supaya yang terjepret wajah yang DIAM,
          // bukan wajah yang kebetulan melintasi tengah saat masih berputar.
          if (Math.abs(yaw) <= CENTER_DEG) {
            tickTengahRef.current += 1;
            if (tickTengahRef.current >= TICK_TENGAH_MANTAP) {
              phaseRef.current = "binding";
              void jalankanPengikatan();
            }
          } else {
            tickTengahRef.current = 0;
            tampilkan(MSG.confirm);
          }
          break;
      }
    },
    [jalankanPengikatan, resetDenganPesan, tampilkan],
  );

  return {
    passed,
    instruction,
    /** Baris kedua di bawah instruksi; kosong kalau pesannya tidak punya. */
    sub: SUB[instruction] ?? "",
    /** Mewarnai kartu instruksi: netral, peringatan, atau lolos. */
    nada: NADA[instruction] ?? ("netral" as NadaPesan),
    /** Sisi yang ditunjuk panah, atau null bila tidak ada panah: platform
     *  yang tanda yaw-nya belum diukur, atau pesan yang sedang tampil bukan
     *  perintah tolehan (menghadap tengah, peringatan, wajah hilang). */
    arahPanah:
      instruction === MSG.first || instruction === MSG.panah
        ? arahTolehan
        : null,
    step,
    // Jumlah langkah berbeda tiap sesi karena rencananya diundi - jadi ikut
    // dilaporkan, bukan angka tetap.
    total,
    isBinding,
    onFacesDetected,
    reset,
  };
}
