import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet, apiPostForm } from "./api";

/**
 * Program default untuk PRESENSI (Opsi A).
 *
 * Di server LKH KKN tidak ada endpoint presensi/absen tersendiri: kehadiran
 * harian hanya bisa dicatat lewat /api/simpan-lkh, dan tiap record LKH WAJIB
 * menunjuk ke sebuah program (program_id) yang sudah ada lebih dulu
 * (dipastikan dari source Flutter resmi - lihat postSimpanLkh & postSimpanProgram).
 *
 * Aplikasi ini fokus presensi saja dan sengaja TIDAK menampilkan pemilihan
 * program maupun isian laporan. Supaya presensi berfoto tetap sampai ke
 * server, modul ini menyediakan SATU program default per peserta secara
 * otomatis dan tak terlihat pengguna:
 *   1. Ambil daftar program peserta (/api/program). Kalau sudah ada, pakai
 *      program pertama.
 *   2. Kalau kosong, buat satu program default (/api/simpan-program), lalu
 *      ambil ulang untuk memperoleh id-nya.
 * Id-nya di-cache di AsyncStorage agar tidak diulang tiap sinkron.
 */

const PROGRAM_ID_KEY = "@presensi_program_id";
const PATH_PROGRAM = "/api/program";
const PATH_SIMPAN_PROGRAM = "/api/simpan-program";

/** Nama & deskripsi tetap untuk program presensi otomatis. */
const DEFAULT_NAMA = "Presensi KKN";
const DEFAULT_DESKRIPSI = "Program presensi otomatis (kehadiran harian).";
/** Deskripsi tetap tiap record presensi. */
export const PRESENSI_DESKRIPSI = "Presensi harian.";

interface ProfileIds {
  penggunaId: string | null;
  nim: string | null;
  angkatanId: string | number | null;
  wilayahId: string | number | null;
  tanggalMulai: string | null;
  tanggalSelesai: string | null;
}

async function readProfileIds(): Promise<ProfileIds> {
  const [id, nim, profileRaw] = await Promise.all([
    AsyncStorage.getItem("@user_id"),
    AsyncStorage.getItem("@user_nim"),
    AsyncStorage.getItem("@user_profile"),
  ]);
  let angkatanId: string | number | null = null;
  let wilayahId: string | number | null = null;
  let tanggalMulai: string | null = null;
  let tanggalSelesai: string | null = null;
  if (profileRaw) {
    try {
      const p = JSON.parse(profileRaw);
      angkatanId = p.angkatanId ?? null;
      wilayahId = p.wilayahId ?? null;
      tanggalMulai = p.angkatanTanggalMulai ?? p.settingTanggalMulai ?? null;
      tanggalSelesai = p.angkatanTanggalSelesai ?? p.settingTanggalSelesai ?? null;
    } catch {
      // profil rusak - biarkan null, ditangani pemanggil
    }
  }
  return { penggunaId: id, nim, angkatanId, wilayahId, tanggalMulai, tanggalSelesai };
}

/** Ambil id program pertama dari daftar program peserta, atau null. */
function firstProgramId(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  if (first && typeof first === "object" && "id" in first) {
    const id = (first as { id: unknown }).id;
    if (id != null) return String(id);
  }
  return null;
}

/**
 * Kembalikan program_id yang dipakai untuk presensi, membuat program default
 * bila peserta belum punya. Melempar bila sesi tidak lengkap atau server tak
 * bisa dihubungi - pemanggil (sinkron) memperlakukannya sebagai kegagalan
 * yang pesannya ditampilkan apa adanya.
 */
/**
 * Ambil id program pertama peserta. MENELAN error (mis. /api/program crash di
 * server saat peserta belum punya program) dan mengembalikan null, supaya
 * pemanggil bisa lanjut mencoba MEMBUAT program alih-alih berhenti.
 */
async function tryFetchFirstProgram(
  nim: string,
  token: string,
): Promise<string | null> {
  try {
    const list = await apiGet<unknown>(PATH_PROGRAM, token, { nim });
    return firstProgramId(list);
  } catch {
    return null;
  }
}

export async function ensurePresensiProgramId(token: string): Promise<string> {
  // 1. Cache lokal.
  const cached = await AsyncStorage.getItem(PROGRAM_ID_KEY);
  if (cached) return cached;

  const ids = await readProfileIds();
  if (!ids.nim) throw new Error("Sesi tidak lengkap (nim tidak ada).");

  // 2. Sudah punya program? (menelan error - lihat tryFetchFirstProgram)
  let programId = await tryFetchFirstProgram(ids.nim, token);

  // 3. Belum ada / GET gagal - buat satu program default lalu ambil ulang.
  if (!programId) {
    if (ids.penggunaId == null || ids.angkatanId == null || ids.wilayahId == null) {
      throw new Error(
        "Data peserta belum lengkap untuk membuat program presensi " +
          `(pengguna_id=${ids.penggunaId ?? "?"}, angkatan_id=${ids.angkatanId ?? "?"}, ` +
          `wilayah_id=${ids.wilayahId ?? "?"}). Coba logout lalu login lagi.`,
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    // POST simpan-program. Kalau server membalas HTML (crash), error-nya
    // dilempar apa adanya ke pengguna - itu berarti endpoint program memang
    // bermasalah, bukan sekadar "belum ada program".
    await apiPostForm<unknown>(PATH_SIMPAN_PROGRAM, token, {
      kode_program: `PRESENSI-${ids.penggunaId}`,
      nama_program: DEFAULT_NAMA,
      deskripsi_program: DEFAULT_DESKRIPSI,
      wilayah_id: String(ids.wilayahId),
      pengguna_id: String(ids.penggunaId),
      angkatan_id: String(ids.angkatanId),
      tanggal_mulai: ids.tanggalMulai || today,
      tanggal_selesai: ids.tanggalSelesai || today,
    });
    // Ambil ulang untuk memperoleh id yang diberikan server.
    programId = await tryFetchFirstProgram(ids.nim, token);
    if (!programId) {
      throw new Error(
        "Program presensi terkirim tapi tidak bisa dibaca kembali - " +
          "endpoint /api/program kemungkinan bermasalah di server.",
      );
    }
  }

  await AsyncStorage.setItem(PROGRAM_ID_KEY, programId);
  return programId;
}

/** Bersihkan cache program - dipanggil saat logout. */
export async function clearPresensiProgramCache(): Promise<void> {
  await AsyncStorage.removeItem(PROGRAM_ID_KEY);
}

