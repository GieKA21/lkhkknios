import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { Platform } from "react-native";

/**
 * UKUR WAKTU VERIFIKASI - build uji untuk BAB IV subbab D.
 *
 * Berkas ini hanya ada di cabang `uji/waktu-verifikasi`. Saat saklarnya
 * true, setiap percobaan verifikasi mencatat lamanya sejak shutter ditekan
 * hingga putusan siap ditampilkan, dan presensinya TIDAK disimpan, supaya
 * percobaan dapat diulang 20 kali pada hari yang sama tanpa terhalang
 * "Sudah Absen".
 *
 * Yang diukur hanya rantai yang dijalankan agen, dipecah per tahap:
 *   ambil   - capturePhotoToFile()
 *   embed   - getFaceEmbedding(): deteksi wajah, gerbang mutu, pemotongan,
 *             dan inferensi MobileFaceNet
 *   putusan - decideAttendance(): median kemiripan terhadap set terdaftar
 * Tantangan keaktifan sengaja tidak ikut dihitung, karena lamanya ditentukan
 * oleh kecepatan pengguna menoleh, bukan oleh perangkat.
 *
 * Ambang, tantangan keaktifan, dan pengikatan identitas tetap berjalan asli;
 * yang dilewati hanya penyimpanan presensinya.
 */
export const UKUR_WAKTU_VERIFIKASI = true;

const KUNCI = "@uji_waktu_verifikasi_v1";

export type SampelWaktu = {
  pada: string;
  putusan: "accepted" | "rejected";
  kemiripan: number;
  ambilMs: number;
  embedMs: number;
  putusanMs: number;
  totalMs: number;
};

export async function bacaSampel(): Promise<SampelWaktu[]> {
  try {
    const mentah = await AsyncStorage.getItem(KUNCI);
    return mentah ? (JSON.parse(mentah) as SampelWaktu[]) : [];
  } catch {
    return [];
  }
}

export async function catatSampel(s: SampelWaktu): Promise<SampelWaktu[]> {
  const semua = [...(await bacaSampel()), s];
  await AsyncStorage.setItem(KUNCI, JSON.stringify(semua));
  return semua;
}

export async function hapusSampel(): Promise<void> {
  await AsyncStorage.removeItem(KUNCI);
}

export function perangkat(): string {
  return `${Device.modelName ?? "?"} (${Platform.OS} ${Device.osVersion ?? "?"})`;
}

function ringkas(nilai: number[]): string {
  const rata = nilai.reduce((a, b) => a + b, 0) / nilai.length;
  return `rata-rata ${rata.toFixed(0)} ms, min ${Math.min(...nilai).toFixed(0)}, maks ${Math.max(...nilai).toFixed(0)}`;
}

/** Teks singkat untuk Alert sesudah satu percobaan. */
export function teksRingkas(ini: SampelWaktu, semua: SampelWaktu[]): string {
  return (
    `\n\nMODE UKUR - presensi tidak disimpan.\n` +
    `Percobaan ke-${semua.length}: ${ini.totalMs.toFixed(0)} ms ` +
    `(ambil ${ini.ambilMs.toFixed(0)}, embed ${ini.embedMs.toFixed(0)}, ` +
    `putusan ${ini.putusanMs.toFixed(0)}).\n` +
    `Seluruh percobaan: ${ringkas(semua.map((x) => x.totalMs))}.`
  );
}

/** Laporan lengkap untuk dibagikan: ringkasan per tahap lalu CSV mentah. */
export function teksLaporan(semua: SampelWaktu[]): string {
  const baris = semua.map((x, i) =>
    [i + 1, x.pada, x.putusan, x.kemiripan.toFixed(4), x.ambilMs.toFixed(1),
      x.embedMs.toFixed(1), x.putusanMs.toFixed(1), x.totalMs.toFixed(1)].join(","),
  );
  return [
    `Uji waktu verifikasi - ${perangkat()}`,
    `n = ${semua.length}`,
    `total   : ${ringkas(semua.map((x) => x.totalMs))}`,
    `ambil   : ${ringkas(semua.map((x) => x.ambilMs))}`,
    `embed   : ${ringkas(semua.map((x) => x.embedMs))}`,
    `putusan : ${ringkas(semua.map((x) => x.putusanMs))}`,
    "",
    "no,waktu,putusan,kemiripan,ambil_ms,embed_ms,putusan_ms,total_ms",
    ...baris,
  ].join("\n");
}
