import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { API_USER_AGENT, APP_VERSION, getDeviceInfoStr } from "./deviceInfo";

/**
 * Lapisan tipis di atas fetch() untuk API LKH KKN.
 *
 * Sebelum ini setiap pemanggil (LoginScreen, LKHScreen, ProfileScreen)
 * mengulang hal yang sama sendiri-sendiri: menempel base URL, menyusun
 * query `device_info`/`version`, memasang header Bearer + User-Agent Dart,
 * membaca respons sebagai teks dulu untuk mendeteksi HTML (sesi kadaluarsa /
 * block page Cloudflare), baru JSON.parse, lalu membongkar amplop
 * {statusCode, data, desc}. Enam salinan aturan yang sama berarti enam
 * tempat yang bisa lupa salah satunya - dan lupa User-Agent saja sudah
 * cukup membuat request tidak pernah sampai ke server (lihat deviceInfo.ts).
 *
 * Modul ini tidak mengubah perilaku apa pun, hanya menyatukan aturannya.
 */

// Host server LKH KKN - SATU sumber kebenaran untuk seluruh aplikasi
// (LKHScreen, LoginScreen, faceServer, foto profil semua mengimpor ini).
//
//   prod : https://lkh-kkn.uin-alauddin.ac.id  <- DIPAKAI. Publik, HTTP 200.
//   dev  : https://lkh-dev.uin-alauddin.ac.id  <- source Flutter dosen, TAPI
//          server INTERNAL kampus: TIDAK bisa dijangkau dari internet publik
//          (diverifikasi: connect gagal/000 dari luar jaringan kampus). Login
//          dari HP biasa akan "kesalahan koneksi". Hanya berguna kalau HP ada
//          di jaringan kampus / VPN dosen.
//
// Akun KKN aktif mahasiswa ada di PROD, jadi prod adalah default yang benar.
// Endpoint wajah & pembimbing juga ada di prod. Ganti ke dev hanya untuk uji
// di jaringan kampus - cukup satu baris di bawah.
export const API_BASE = "https://lkh-kkn.uin-alauddin.ac.id";

/** Server membalas HTML, bukan JSON - token kadaluarsa atau diblokir WAF. */
class SessionExpiredError extends Error {}

/** Server menjawab dengan benar tapi menolak permintaannya. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

interface ApiEnvelope<T> {
  statusCode?: number;
  data?: T;
  desc?: string;
  message?: string;
}

function buildUrl(path: string, params?: Record<string, string | number>): string {
  const query = new URLSearchParams({
    ...(params
      ? Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, String(v)]),
        )
      : {}),
    version: APP_VERSION,
  }).toString();
  // getDeviceInfoStr() sudah URL-encoded, jadi ditempel manual - melewatkannya
  // lewat URLSearchParams akan meng-encode ulang tanda %-nya.
  return `${API_BASE}${path}?${query}&device_info=${getDeviceInfoStr()}`;
}

function authHeaders(token: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": API_USER_AGENT,
    ...extra,
  };
}

/**
 * Baca respons, deteksi HTML, bongkar amplop {statusCode, data, desc}.
 * Melempar SessionExpiredError untuk HTML dan ApiError untuk penolakan yang
 * formatnya benar - pesan asli server dipertahankan apa adanya, karena
 * itulah satu-satunya petunjuk saat nama field harus dikoreksi (tak ada
 * dokumentasi API publik).
 */
async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.trim().startsWith("<")) {
    throw new SessionExpiredError(
      "Sesi login kadaluarsa atau permintaan diblokir server.",
    );
  }

  let parsed: ApiEnvelope<T>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(
      `Server merespons non-JSON (HTTP ${response.status}).`,
      response.status,
      text.slice(0, 200),
    );
  }

  // Kode sukses di amplop server ini TIDAK konsisten: ada 200, 207, dan
  // kemungkinan kode 2xx lain, semuanya bertanda desc "Berhasil" (max-reset
  // terbukti membalas "Berhasil" dengan kode selain 200/207). App resmi
  // (Flutter) bahkan tidak memeriksa statusCode sama sekali - ia hanya
  // memakai validateStatus: status < 500 lalu membaca data. Jadi anggap
  // sukses bila: HTTP-nya ok DAN (statusCode kosong, ATAU 2xx apa pun -
  // termasuk yang datang sebagai string, ATAU desc-nya "Berhasil").
  const codeNum =
    typeof parsed.statusCode === "string"
      ? Number(parsed.statusCode)
      : parsed.statusCode;
  const descBerhasil =
    typeof parsed.desc === "string" &&
    parsed.desc.trim().toLowerCase() === "berhasil";
  const ok =
    response.ok &&
    (parsed.statusCode === undefined ||
      (typeof codeNum === "number" && codeNum >= 200 && codeNum < 300) ||
      descBerhasil);
  if (!ok) {
    throw new ApiError(
      parsed.desc || parsed.message || `HTTP ${response.status}`,
      response.status,
      text.slice(0, 200),
    );
  }
  return (parsed.data ?? (parsed as unknown)) as T;
}

export async function apiGet<T>(
  path: string,
  token: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: authHeaders(token, { "Accept-Encoding": "gzip" }),
  });
  return unwrap<T>(response);
}

/**
 * POST multipart. Bentuk ini dipakai (bukan JSON) karena itulah bentuk yang
 * diterima endpoint-endpoint di server ini.
 */
/* ------------------------------------------------------------------ *
 * Foto profil peserta
 *
 * Ketiganya dipakai IDENTIK oleh LKHScreen dan ProfileScreen. Sebelumnya
 * disalin utuh di kedua layar, termasuk header Bearer + User-Agent Dart yang
 * kalau terlewat membuat foto gagal diam-diam dan jatuh ke placeholder abu-
 * abu (lihat catatan di deviceInfo.ts).
 * ------------------------------------------------------------------ */

export function profilePhotoUrl(fotoName: string): string {
  return `${API_BASE}/api/profil-peserta?profil=${fotoName}&device_info=${getDeviceInfoStr()}&version=${APP_VERSION}`;
}

/** Foto profil DOSEN pembimbing (/api/profil-pembimbing?profil=pegFoto). */
export function pembimbingPhotoUrl(fotoName: string): string {
  return `${API_BASE}/api/profil-pembimbing?profil=${fotoName}&device_info=${getDeviceInfoStr()}&version=${APP_VERSION}`;
}

/**
 * Header untuk <Image source={{ uri, headers }}>. Selama foto belum
 * terunduh ke lokal, URI-nya masih menunjuk endpoint yang butuh token -
 * tanpa header ini request-nya gagal tanpa pesan.
 */
export function profilePhotoHeaders(token: string): Record<string, string> {
  return token
    ? { Authorization: `Bearer ${token}`, "User-Agent": API_USER_AGENT }
    : { "User-Agent": API_USER_AGENT };
}

/** Unduh foto profil ke berkas lokal (butuh header token); null kalau gagal. */
async function downloadProfilePhoto(
  url: string,
  token: string,
  fileName: string,
): Promise<string | null> {
  try {
    const { uri, status } = await FileSystem.downloadAsync(
      url,
      FileSystem.documentDirectory + fileName,
      { headers: { ...profilePhotoHeaders(token), "Accept-Encoding": "gzip" } },
    );
    return status === 200 ? uri : null;
  } catch {
    return null;
  }
}

// Kenapa foto di-cache ke berkas lokal: endpoint foto (/api/profil-peserta)
// butuh token & ada di balik WAF. Kalau <Image> menariknya LANGSUNG dari URL
// remote setiap kali layar (LKH/Profil) di-mount, iOS menarik ULANG tiap mount,
// dan penarikan berulang itu sering gagal (WAF/rate-limit) sehingga foto
// berkedip jadi inisial. Solusinya: unduh SEKALI ke berkas lokal, lalu semua
// layar menampilkan berkas lokal itu - tak ada penarikan remote berulang.
const PHOTO_SRC_URL_KEY = "@profile_photo_src_url";
const PHOTO_LOCAL_URI_KEY = "@profile_photo_local_uri";

/**
 * URI berkas LOKAL foto profil (di-cache). Mengunduh dari `remoteUrl` sekali
 * (mengunduh ulang hanya bila URL sumbernya berubah), lalu memakai ulang berkas
 * lokalnya. Mengembalikan null bila unduhan gagal - pemanggil bisa jatuh ke URL
 * remote atau avatar inisial.
 */
export async function getCachedProfilePhoto(
  remoteUrl: string,
  token: string,
): Promise<string | null> {
  try {
    const [srcUrl, localUri] = await Promise.all([
      AsyncStorage.getItem(PHOTO_SRC_URL_KEY),
      AsyncStorage.getItem(PHOTO_LOCAL_URI_KEY),
    ]);
    if (srcUrl === remoteUrl && localUri) {
      const info = await FileSystem.getInfoAsync(localUri);
      if (info.exists) return localUri;
    }
    const local = await downloadProfilePhoto(
      remoteUrl,
      token,
      "profile_photo.jpg",
    );
    if (local) {
      await AsyncStorage.multiSet([
        [PHOTO_SRC_URL_KEY, remoteUrl],
        [PHOTO_LOCAL_URI_KEY, local],
      ]);
      return local;
    }
  } catch {
    // best-effort - pemanggil jatuh ke URL remote / inisial
  }
  return null;
}

/** Bersihkan cache foto lokal - dipanggil saat logout supaya akun berikutnya
 *  tidak memakai foto akun sebelumnya. */
export async function clearCachedProfilePhoto(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([PHOTO_SRC_URL_KEY, PHOTO_LOCAL_URI_KEY]);
  } catch {
    // abaikan
  }
}

export async function apiPostForm<T>(
  path: string,
  token: string,
  fields: Record<string, string | Blob>,
): Promise<T> {
  const body = new FormData();
  body.append("device_info", decodeURIComponent(getDeviceInfoStr()));
  body.append("version", APP_VERSION);
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value as string);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(token, { Accept: "application/json" }),
    body,
  });
  return unwrap<T>(response);
}
