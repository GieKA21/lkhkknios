import { apiGet, apiPostForm } from "./api";
import { DEMO_TOKEN } from "./demoMode";

/**
 * Sisi server untuk data wajah - mengikuti aplikasi Android resmi, yang
 * menyimpan wajah terdaftar di SERVER, bukan di HP.
 *
 * ASAL PENGETAHUAN INI - kini DIPASTIKAN dari source Flutter resmi
 * (gitlab.com/nur.afif/lkh-kkn, lib/api/api_interface.dart), bukan lagi
 * tebakan dari APK. Yang terbukti di sana:
 *
 *   POST /api/simpan-face-data : FormData { "id": peserta.id, "face_data": ... }
 *   GET  /api/face-data        : query   { "id": peserta.id }
 *   /api/reset-wajah  /api/jumlah-reset  /api/max-reset  /api/simpan-reset
 *
 * KOREKSI PENTING: kuncinya adalah `id` NUMERIK peserta, BUKAN nim/kode -
 * dulu kode ini keliru mengirim nim. Jatah reset otoritasnya di server (tabel
 * lokal `reset(reset_peserta_id, ...)` cuma cache).
 *
 * SATU DIVERGENSI YANG DISENGAJA: app Flutter menyimpan SATU embedding
 * (predictedData.toString()); app ini menyimpan BANYAK (median-of-N, lebih
 * akurat). Karena kedua ujung (iOS & Android) sama-sama app RN kita, JSON
 * array-of-array kita bulak-balik konsisten lewat parseEmbeddings di bawah.
 * Kalau server ternyata memvalidasi ketat 192 angka, PESAN ASLINYA muncul ke
 * pengguna lewat ApiError - itu patokan koreksi berikutnya.
 *
 * BELUM DIVERIFIKASI LIVE: format ini benar menurut source, tapi belum
 * pernah diuji terhadap server dengan akun valid. Server aktif = prod
 * (lkh-kkn); lkh-dev dosen internal kampus, tak terjangkau publik - lihat
 * API_BASE di api.ts.
 */

const PATH_FETCH = "/api/face-data";
const PATH_SAVE = "/api/simpan-face-data";
const PATH_RESET = "/api/reset-wajah";
const PATH_RESET_SAVE = "/api/simpan-reset";
const PATH_RESET_COUNT = "/api/jumlah-reset";
const PATH_RESET_MAX = "/api/max-reset";

// NAMA FIELD BERBEDA PER ENDPOINT - dipastikan dari source Flutter resmi:
//   /api/face-data, /api/simpan-face-data  -> field "id"
//   /api/reset-wajah, /api/simpan-reset,
//   /api/jumlah-reset                       -> field "pengguna_id"
//   /api/max-reset                          -> TANPA parameter apa pun
// Nilai keduanya sama (id numerik peserta), hanya nama fieldnya beda. Dulu
// seluruh endpoint reset keliru dikirim "id", sehingga server menolaknya dan
// aplikasi jatuh ke cache lokal - itulah sebab kuota reset "tidak berubah"
// walau sudah diedit di database.

/** Nama field payload wajah. Satu-satunya kandidat yang muncul di libapp.so. */
const FIELD_FACE_DATA = "face_data";

export interface ServerResetInfo {
  used: number;
  max: number;
}

/**
 * Endpoint wajah memakai `id` NUMERIK peserta sebagai kunci, BUKAN nim -
 * dipastikan dari source Flutter resmi: postSimpanFaceData(peserta.id, ...)
 * dan getFaceData({id}). Lihat [[lkh-flutter-source-api]].
 *
 * Mode demo memakai token lokal yang pasti ditolak server (lihat demoMode.ts),
 * jadi permintaannya dilewati - bukan dikirim lalu gagal. Sesi tanpa id
 * numerik (mis. profil lama sebelum id ditangkap) juga dilewati.
 */
function isUsableSession(id: string | null, token: string | null): boolean {
  return !!id && !!token && token !== DEMO_TOKEN;
}

/**
 * Terima array-of-array (banyak wajah terdaftar), satu array datar (satu
 * wajah, gaya lama), atau string JSON berisi salah satunya. Nilai yang tidak
 * masuk akal dibuang, bukan diteruskan - embedding rusak yang lolos ke
 * pembanding menghasilkan "kemiripan NaN%" yang pernah terjadi sebelumnya.
 */
function parseEmbeddings(raw: unknown): number[][] | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;

  const rows = typeof value[0] === "number" ? [value] : value;
  const clean: number[][] = [];
  for (const row of rows) {
    if (
      Array.isArray(row) &&
      row.length > 0 &&
      row.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      clean.push(row as number[]);
    }
  }
  return clean.length > 0 ? clean : null;
}

function pickFaceField(payload: unknown): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    // Amplop {data:{face_data:...}} sudah dibongkar satu lapis oleh apiGet;
    // sisanya bisa saja langsung field-nya, atau objek yang memuatnya.
    if (FIELD_FACE_DATA in obj) return obj[FIELD_FACE_DATA];
    if ("encoding" in obj) return obj.encoding;
    if ("encodings" in obj) return obj.encodings;
  }
  return payload;
}

/**
 * Ambil set wajah terdaftar milik peserta (`id` numerik) dari server.
 * - array embedding  -> server punya data
 * - null             -> server bisa dihubungi tapi belum ada wajah terdaftar
 * - lempar           -> server tidak bisa dihubungi / sesi habis; PEMANGGIL
 *                       WAJIB jatuh ke cache lokal, jangan anggap "kosong"
 *                       (menganggapnya kosong akan memaksa daftar ulang
 *                       setiap kali internet mati).
 */
export async function fetchServerEnrollment(
  id: string | null,
  token: string | null,
): Promise<number[][] | null> {
  if (!isUsableSession(id, token)) return null;
  const payload = await apiGet<unknown>(PATH_FETCH, token!, { id: id! });
  return parseEmbeddings(pickFaceField(payload));
}

/** Kirim set wajah terdaftar ke server (dipakai setelah enrollment selesai). */
export async function pushServerEnrollment(
  id: string | null,
  token: string | null,
  embeddings: number[][],
): Promise<void> {
  if (!isUsableSession(id, token)) {
    throw new Error("Sesi tidak tersedia untuk mengirim data wajah.");
  }
  await apiPostForm<unknown>(PATH_SAVE, token!, {
    id: id!,
    [FIELD_FACE_DATA]: JSON.stringify(embeddings),
  });
}

/**
 * Jatah reset menurut server. Dua endpoint terpisah di app Android
 * (/api/jumlah-reset dan /api/max-reset) - keduanya diambil sekaligus dan
 * kegagalan salah satunya membatalkan keduanya, supaya tidak pernah muncul
 * kombinasi setengah-server-setengah-lokal yang menyesatkan.
 */
export async function fetchServerResetInfo(
  id: string | null,
  token: string | null,
): Promise<ServerResetInfo | null> {
  if (!isUsableSession(id, token)) return null;
  const [countRaw, maxRaw] = await Promise.all([
    // jumlah-reset dikunci pengguna_id; max-reset TANPA parameter (nilainya
    // sama untuk semua peserta).
    apiGet<unknown>(PATH_RESET_COUNT, token!, { pengguna_id: id! }),
    apiGet<unknown>(PATH_RESET_MAX, token!),
  ]);

  const num = (payload: unknown, ...keys: string[]): number | null => {
    if (typeof payload === "number") return payload;
    if (typeof payload === "string" && payload.trim() !== "") {
      const parsed = Number(payload);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (payload && typeof payload === "object") {
      for (const key of keys) {
        const found = num((payload as Record<string, unknown>)[key]);
        if (found !== null) return found;
      }
    }
    return null;
  };

  const used = num(countRaw, "reset_jumlah", "jumlah", "jumlah_reset");
  const max = num(maxRaw, "reset_maksimum", "maksimum", "max_reset");
  if (used === null || max === null) return null;
  return { used, max };
}

/**
 * DIAGNOSTIK: tampilkan respons MENTAH endpoint jatah reset, apa adanya, untuk
 * menelusuri kenapa jatah reset tidak berubah walau sudah diedit di database.
 * Menunjukkan id yang dipakai, respons jumlah-reset & max-reset (atau pesan
 * error server), sehingga terlihat apakah masalahnya di server, di nama field,
 * atau di cache lokal.
 */
export async function describeServerReset(
  id: string | null,
  token: string | null,
): Promise<string> {
  if (!id) return "reset server: @user_id KOSONG (login ulang untuk mengisinya)";
  if (!token) return "reset server: token kosong";

  const probe = async (
    label: string,
    path: string,
    params?: Record<string, string>,
  ): Promise<string> => {
    try {
      const raw = await apiGet<unknown>(path, token, params);
      return `${label}: ${JSON.stringify(raw)}`;
    } catch (e) {
      return `${label}: ERROR ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const lines = [
    `pengguna_id dipakai: ${id}`,
    await probe("jumlah-reset", PATH_RESET_COUNT, { pengguna_id: id }),
    await probe("max-reset", PATH_RESET_MAX),
  ];
  return lines.join("\n");
}

/** Minta server menghapus wajah terdaftar dan menambah hitungan reset. */
export async function requestServerReset(
  id: string | null,
  token: string | null,
): Promise<void> {
  if (!isUsableSession(id, token)) {
    throw new Error("Sesi tidak tersedia untuk reset wajah.");
  }
  // Dua langkah, mengikuti app resmi: hapus wajah terdaftar (reset-wajah),
  // lalu catat pemakaian jatah reset (simpan-reset). Keduanya dikunci
  // pengguna_id. Tanpa simpan-reset, hitungan jatah di server tidak bertambah.
  await apiPostForm<unknown>(PATH_RESET, token!, { pengguna_id: id! });
  await apiPostForm<unknown>(PATH_RESET_SAVE, token!, { pengguna_id: id! });
}
