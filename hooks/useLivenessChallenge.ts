import { useCallback, useRef, useState } from "react";
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

type Phase =
  | "first-turn"
  | "return-center"
  | "second-turn"
  | "confirm-center"
  | "binding"
  | "passed";

const MSG = {
  frame: "Posisikan wajah Anda di dalam bingkai",
  near: "Dekatkan wajah Anda ke kamera",
  first: "Tolehkan kepala perlahan ke satu sisi",
  center: "Bagus - hadapkan lagi ke tengah",
  second: "Sekarang toleh ke sisi sebaliknya",
  confirm: "Terakhir - hadapkan wajah lurus ke kamera",
  binding: "Memeriksa identitas, mohon tunggu...",
  ulangi: "Wajah kurang jelas - hadapkan lurus ke kamera sekali lagi",
  putus: "Wajah sempat hilang dari kamera - tantangan diulang dari awal",
  passed: "Deteksi aktif berhasil - silakan ambil foto",
} as const;

export function useLivenessChallenge(
  onBind?: () => Promise<HasilPengikatan>,
) {
  // State mesin disimpan di ref, bukan useState: onFacesDetected dipanggil
  // per frame dan harus stabil (tidak dibuat ulang tiap render), jadi ia
  // tidak boleh menutup nilai state yang bisa basi. useState hanya untuk
  // nilai yang benar-benar dirender.
  const phaseRef = useRef<Phase>("first-turn");
  const firstSignRef = useRef<-1 | 0 | 1>(0);
  const ulangMutuRef = useRef(0);
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
  const [isBinding, setIsBinding] = useState(false);

  /** Mulai dari nol dengan pesan tertentu. */
  const resetDenganPesan = useCallback((pesan: string) => {
    phaseRef.current = "first-turn";
    firstSignRef.current = 0;
    ulangMutuRef.current = 0;
    kotakRef.current = null;
    tickHilangRef.current = 0;
    tickTengahRef.current = 0;
    setPassed(false);
    setStep(0);
    setIsBinding(false);
    setInstruction(pesan);
  }, []);

  const reset = useCallback(() => {
    resetDenganPesan(MSG.first);
  }, [resetDenganPesan]);

  const jalankanPengikatan = useCallback(async () => {
    const bind = onBindRef.current;
    // Tanpa callback pengikatan, perilakunya kembali seperti semula: lulus
    // begitu tolehan kedua selesai. Sengaja TIDAK menolak diam-diam, supaya
    // pemanggil yang lupa memasang onBind tidak mengunci penggunanya.
    if (!bind) {
      phaseRef.current = "passed";
      setStep(3);
      setPassed(true);
      setInstruction(MSG.passed);
      return;
    }
    setIsBinding(true);
    setInstruction(MSG.binding);
    let hasil: HasilPengikatan;
    try {
      hasil = await bind();
    } catch {
      hasil = "ulangi";
    }
    setIsBinding(false);
    // Frame diabaikan selama pengikatan, jadi kotak terakhir sudah basi -
    // tanpa dikosongkan, tick pertama sesudah ini akan terbaca sebagai
    // lompatan dan membatalkan tantangan yang justru baru saja lulus.
    kotakRef.current = null;
    tickHilangRef.current = 0;

    if (hasil === "ok") {
      phaseRef.current = "passed";
      setStep(3);
      setPassed(true);
      setInstruction(MSG.passed);
      return;
    }
    if (hasil === "ulangi" && ulangMutuRef.current < MAKS_ULANG_MUTU) {
      ulangMutuRef.current += 1;
      phaseRef.current = "confirm-center";
      tickTengahRef.current = 0;
      setInstruction(MSG.ulangi);
      return;
    }
    // Identitas tidak cocok, atau mutu gagal terus - ulang dari awal.
    // Pesannya ditentukan pemanggil lewat Alert; di sini cukup instruksi.
    resetDenganPesan(MSG.first);
  }, [resetDenganPesan]);

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
        if (kotakRef.current === null) {
          if (!sudahLulus) setInstruction(pesan);
          return;
        }
        tickHilangRef.current += 1;
        if (tickHilangRef.current > MAKS_TICK_HILANG) {
          resetDenganPesan(MSG.putus);
          return;
        }
        if (!sudahLulus) setInstruction(pesan);
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
        setInstruction(MSG.near);
        return;
      }

      const yaw = face.yawAngle;

      switch (phaseRef.current) {
        case "first-turn":
          if (Math.abs(yaw) >= TURN_DEG) {
            firstSignRef.current = yaw >= 0 ? 1 : -1;
            phaseRef.current = "return-center";
            setStep(1);
            setInstruction(MSG.center);
          } else {
            setInstruction(MSG.first);
          }
          break;

        case "return-center":
          if (Math.abs(yaw) <= CENTER_DEG) {
            phaseRef.current = "second-turn";
            setInstruction(MSG.second);
          } else {
            setInstruction(MSG.center);
          }
          break;

        case "second-turn":
          // Harus melampaui ambang KE ARAH BERLAWANAN dari tolehan pertama.
          if (
            Math.abs(yaw) >= TURN_DEG &&
            (yaw >= 0 ? 1 : -1) === -firstSignRef.current
          ) {
            phaseRef.current = "confirm-center";
            setStep(2);
            setInstruction(MSG.confirm);
          } else {
            setInstruction(MSG.second);
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
            setInstruction(MSG.confirm);
          }
          break;
      }
    },
    [jalankanPengikatan, resetDenganPesan],
  );

  return {
    passed,
    instruction,
    step,
    total: 3,
    isBinding,
    onFacesDetected,
    reset,
  };
}
