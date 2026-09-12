import { apiGet, apiPostForm } from "./api";

/**
 * Sisi API PEMBIMBING (dosen pembimbing) - P1 dari pembangunan fitur
 * pembimbing di aplikasi RN ini. Direplikasi SETIA dari source Flutter resmi
 * (gitlab.com/nur.afif/lkh-kkn, lib/api/api_interface.dart), server yang sama,
 * jadi bentuk request-nya otoritatif.
 *
 * Pembimbing dikunci dengan **NIP** (bukan id/nim peserta). Kontraknya:
 *   GET  /api/pembimbing          {nip}          -> profil pembimbing
 *   GET  /api/peserta-bimbing     {nip}          -> daftar mahasiswa bimbingan
 *   GET  /api/peserta-bimbing-lkh {nip, tanggal} -> LKH mahasiswa pada 1 tanggal
 *   GET  /api/pembimbing-tanggal  {pengguna_id}  -> tanggal + ringkasan checked/total
 *   POST /api/lkh-check           {lkh_id}       -> tandai LKH sudah diperiksa
 *   POST /api/lkh-approved        {lkh_id, value}-> setujui/tolak LKH
 *
 * apiGet/apiPostForm sudah otomatis menempel device_info + version + header
 * Bearer + User-Agent Dart (lihat utils/api.ts), sama seperti interceptor Dio
 * di app Flutter - jadi tak perlu diulang di sini.
 *
 * BELUM DIVERIFIKASI LIVE: benar menurut source, tapi menguji login &
 * pengambilan data butuh akun PEMBIMBING valid di server dev - belum ada.
 * Tipe di bawah sengaja longgar di tempat yang belum dipastikan bentuknya;
 * diperketat saat wiring layar (P2/P3).
 */

const PATH = {
  pembimbing: "/api/pembimbing",
  pesertaBimbing: "/api/peserta-bimbing",
  pesertaBimbingLkh: "/api/peserta-bimbing-lkh",
  pembimbingTanggal: "/api/pembimbing-tanggal",
  lkhCheck: "/api/lkh-check",
  lkhApproved: "/api/lkh-approved",
} as const;

/** Profil pembimbing (dari /api/pembimbing). Field inti yang dipakai UI. */
export interface Pembimbing {
  id: number;
  kode: string;
  nama: string;
  foto?: string | null;
  [key: string]: unknown;
}

/** Satu mahasiswa bimbingan (dari /api/peserta-bimbing). */
export interface SupervisedStudent {
  id: number;
  kode: string; // NIM
  nama: string;
  foto?: string | null;
  [key: string]: unknown;
}

/** LKH satu mahasiswa pada satu tanggal, beserta status periksa/setujui. */
export interface SupervisedLkh {
  [key: string]: unknown;
}

/** Profil pembimbing berdasarkan NIP. */
export function fetchPembimbing(nip: string, token: string): Promise<Pembimbing> {
  return apiGet<Pembimbing>(PATH.pembimbing, token, { nip });
}

/** Daftar mahasiswa yang dibimbing pembimbing (NIP) ini. */
export function fetchSupervisedStudents(
  nip: string,
  token: string,
): Promise<SupervisedStudent[]> {
  return apiGet<SupervisedStudent[]>(PATH.pesertaBimbing, token, { nip });
}

/** LKH seluruh mahasiswa bimbingan pada satu tanggal (YYYY-MM-DD). */
export function fetchSupervisedLkh(
  nip: string,
  tanggal: string,
  token: string,
): Promise<SupervisedLkh[]> {
  return apiGet<SupervisedLkh[]>(PATH.pesertaBimbingLkh, token, { nip, tanggal });
}

/** Tanggal bimbingan + ringkasan (checked/total), berdasarkan id pengguna. */
export function fetchPembimbingDates(
  penggunaId: string | number,
  token: string,
): Promise<unknown[]> {
  return apiGet<unknown[]>(PATH.pembimbingTanggal, token, {
    pengguna_id: penggunaId,
  });
}

/** Tandai satu LKH sudah diperiksa pembimbing. */
export function checkLkh(lkhId: string | number, token: string): Promise<unknown> {
  return apiPostForm<unknown>(PATH.lkhCheck, token, { lkh_id: String(lkhId) });
}

/**
 * Setujui atau tolak satu LKH. `value` mengikuti konvensi server Flutter
 * (postLkhApproved(lkhId, value)) - biasanya 1 = setuju, 0 = tolak; nilai
 * pastinya dikonfirmasi saat wiring dengan akun pembimbing.
 */
export function approveLkh(
  lkhId: string | number,
  value: string | number,
  token: string,
): Promise<unknown> {
  return apiPostForm<unknown>(PATH.lkhApproved, token, {
    lkh_id: String(lkhId),
    value: String(value),
  });
}
