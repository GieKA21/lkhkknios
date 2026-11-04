import { FACE_MATCH_THRESHOLD, FACE_MATCH_THRESHOLD_TOLEH } from "./faceAuthNative";
import { similarityToEnrollment } from "./faceEnrollment";

/**
 * AGEN VERIFIKASI WAJAH (Face-Verification Intelligent Agent).
 *
 * Modul ini menamai secara eksplisit "agen cerdas" yang diminta pada judul
 * skripsi, DIBATASI pada bagian pengenalan wajah. Ia tidak menambah perilaku
 * baru - ia membingkai sistem keputusan on-device yang sudah ada dengan
 * kosakata agen (Russell & Norvig) sehingga bisa dirujuk langsung di laporan.
 * Spesifikasi lengkap + pemetaan ke kode ada di docs/intelligent-agent.md.
 *
 * PEAS (Performance, Environment, Actuators, Sensors)
 * ---------------------------------------------------
 * - Performance : meloloskan pemilik wajah yang HADIR & HIDUP (true-accept
 *   tinggi), menolak impostor dan upaya spoofing foto/layar (false-accept
 *   rendah), dengan friksi seminimal mungkin. Diukur lewat FAR/FRR, akurasi,
 *   dan keberhasilan liveness.
 * - Environment : adegan selfie di depan kamera depan - seorang manusia (atau
 *   foto/layar) dengan pencahayaan & pose beragam. Bersifat sebagian teramati
 *   (satu kamera, tanpa kedalaman), dinamis (subjek bergerak), dan kontinu.
 * - Actuators   : instruksi di layar (tantangan gerak liveness, panduan
 *   framing) dan KEPUTUSAN akhir - membuka shutter lalu terima/tolak absen.
 * - Sensors     : frame kamera (VisionCamera) + percept ML Kit (bounding box,
 *   landmark mata, sudut kepala yaw/pitch/roll, ukuran wajah), serta embedding
 *   192-d MobileFaceNet dari foto still.
 *
 * TIPE AGEN: goal-based agent dengan sub-loop reaktif berstate.
 * Program agen berjalan dalam tiga tahap, dan tiap tahap punya wujud kodenya:
 *   1. PERSEPSI real-time  -> hooks/useFaceQualityGate.ts (kualitas framing)
 *   2. SUB-AGEN LIVENESS    -> hooks/useLivenessChallenge.ts. Ini inti perilaku
 *      agen: mengindra yaw, MEMILIH instruksi berikut dari state internal
 *      (tolehan pertama & tandanya), lalu bertindak (menampilkan instruksi),
 *      berulang sampai goal "passed". Reaktif-berstate, bukan sekali jalan.
 *   3. KEPUTUSAN identitas  -> decideAttendance() di bawah + persepsi still
 *      (getFaceEmbedding di utils/faceAuthNative.ts).
 *
 * decideAttendance() adalah FUNGSI KEPUTUSAN murni sang agen: memetakan
 * embedding hasil persepsi ke satu putusan. Sengaja dipisah dari UI (Alert,
 * state kamera) supaya bisa diuji tanpa perangkat dan dirujuk sebagai unit.
 */

export type AttendanceVerdict =
  | { readonly kind: "not-enrolled" }
  | { readonly kind: "accepted"; readonly similarity: number; readonly threshold: number }
  | { readonly kind: "rejected"; readonly similarity: number; readonly threshold: number };

/**
 * Putusan agen atas satu probe embedding.
 *   - "not-enrolled" : belum ada wajah terdaftar (arahkan ke pendaftaran).
 *   - "accepted"     : kemiripan (median terhadap set terdaftar) >= ambang.
 *   - "rejected"     : kemiripan di bawah ambang.
 *
 * Perilaku identik dengan logika inline lama di LKHScreen.takeSelfie -
 * `rejected` setara `similarity < FACE_MATCH_THRESHOLD`; hanya dinamai sebagai
 * putusan agen. Perhitungan kemiripan (median-of-N) tetap di
 * similarityToEnrollment().
 */
export async function decideAttendance(
  probe: Float32Array | number[],
): Promise<AttendanceVerdict> {
  const similarity = await similarityToEnrollment(probe);
  if (similarity === null) return { kind: "not-enrolled" };

  const threshold = FACE_MATCH_THRESHOLD;
  return similarity >= threshold
    ? { kind: "accepted", similarity, threshold }
    : { kind: "rejected", similarity, threshold };
}

/**
 * Putusan agen atas embedding dari foto wajah yang SEDANG MENOLEH - langkah
 * pengikatan identitas pada tolehan terakhir tantangan keaktifan. Sama dengan
 * decideAttendance, hanya ambangnya FACE_MATCH_THRESHOLD_TOLEH (lihat
 * alasannya di faceAuthNative.ts).
 */
export async function decideTurnedFace(
  probe: Float32Array | number[],
): Promise<AttendanceVerdict> {
  const similarity = await similarityToEnrollment(probe);
  if (similarity === null) return { kind: "not-enrolled" };

  const threshold = FACE_MATCH_THRESHOLD_TOLEH;
  return similarity >= threshold
    ? { kind: "accepted", similarity, threshold }
    : { kind: "rejected", similarity, threshold };
}
