import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEMO_TOKEN } from "./demoMode";

/**
 * MODE LOKAL - build demo untuk seminar proposal.
 *
 * SAKLARNYA ADALAH KONSTANTA DI BAWAH, DAN CABANG INILAH SAKLARNYA. Berkas
 * ini hanya ada di cabang `demo/seminar`; `main` tidak memuatnya sama sekali,
 * jadi build asli tidak mungkin ikut menyala.
 *
 * KENAPA KONSTANTA, BUKAN EXPO_PUBLIC_*. Variabel lingkungan sebenarnya
 * BEKERJA di sini - Metro memang menyisipkannya, dan itu sudah diukur:
 * dengan EXPO_PUBLIC_SUMBER=lokal bundelnya 3.208.406 byte, tanpa variabel
 * (plus --reset-cache) 3.205.919 byte, selisih 2.487 byte karena minifier
 * membuang isi penjaga begitu nilainya false.
 *
 * Masalahnya bukan apakah ia bekerja, tapi betapa mudah ia LUPA DISETEL.
 * Cache transform Metro menyimpan hasil penyisipan per berkas dan TIDAK
 * memperhitungkan variabel lingkungan, jadi sesudah sekali membangun dengan
 * variabel itu, build berikutnya tanpa variabel pun tetap memakai hasil
 * lamanya - dua build yang sumbernya sama menghasilkan bundel identik meski
 * variabelnya berbeda. Artinya variabelnya tidak bisa dipercaya sebagai
 * penentu, dan salahnya tidak kelihatan: build-nya tetap "BUILD SUCCESSFUL".
 *
 * Konstanta tidak punya ruang untuk salah seperti itu. Ia ada di dalam
 * sumber, ikut tercatat di git, dan terbaca langsung tanpa perlu diingat
 * saat membangun.
 *
 * KENAPA PENJAGA DI fetch(), BUKAN TAMBALAN DI TIAP PEMANGGIL.
 * Panggilan jaringan di aplikasi ini ada di enam tempat, dan dua di antaranya
 * - /api/lkh dan /api/simpan-lkh di LKHScreen - memakai fetch() LANGSUNG,
 * bukan apiGet/apiPostForm. Menambal enam tempat berarti enam kesempatan ada
 * yang terlewat, dan satu saja yang lolos sudah cukup membuat demo menunggu
 * timeout di atas panggung. Penjaga di fetch() menangkap keenamnya sekaligus,
 * termasuk kode baru yang belum ada saat ini.
 *
 * YANG TIDAK DILONGGARKAN: verifikasi wajah. Enrollment, pencocokan, ambang
 * 0,673, dan tantangan keaktifan semuanya berjalan asli di perangkat. Itu
 * kontribusi penelitiannya; melonggarkannya akan membuat demonya tidak
 * membuktikan apa pun. Mode lokal hanya memutus SERVER, bukan pengenalannya.
 */
// Tipenya ditulis `boolean`, bukan dibiarkan disimpulkan sebagai `true`.
// Tanpa anotasi itu TypeScript mempersempit tipenya menjadi literal `true`,
// lalu setiap `if (!MODE_LOKAL)` di berkas lain dianggap cabang yang tak
// mungkin tercapai - dan pemeriksa tipe mulai mengeluhkan kode yang justru
// kita perlukan tetap ada supaya saklarnya bisa dibalik.
export const MODE_LOKAL: boolean = true;

/**
 * Host server kampus dikenali dari NAMA DOMAINNYA, bukan dengan mengimpor
 * API_BASE dari api.ts. Dua alasan:
 *   1. api.ts perlu mengimpor MODE_LOKAL dari berkas ini (untuk melewati
 *      unduhan foto), jadi mengimpor balik API_BASE akan membuat impor
 *      berputar.
 *   2. Pencocokan domain menangkap SEMUA host kampus - prod lkh-kkn maupun
 *      dev lkh-dev - jadi mengganti satu baris API_BASE tidak bisa membocorkan
 *      permintaan keluar dari build demo.
 */
const HOST_KAMPUS = "uin-alauddin.ac.id";

/** Jeda tiruan supaya indikator memuat sempat terlihat, seperti jaringan asli. */
const JEDA_MS = 220;

const hariIni = (): Date => new Date();

function geser(hari: number): string {
  const d = hariIni();
  d.setDate(d.getDate() + hari);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Data contoh
 *
 * Periode KKN sengaja dibuat MEMUAT hari ini (-30 sampai +30 hari), supaya
 * pemeriksaan periode di LKHScreen lolos dengan sah. Dengan begitu saklar
 * ABAIKAN_PERIODE_KKN tidak perlu disentuh - ia tetap false seperti di build
 * asli, dan tidak ada aturan yang dilanggar demi demo.
 *
 * poskoKoordinat sengaja null dan kecamatan/kabupaten sengaja kosong, supaya
 * resolvePoskoLocation() memulangkan null tanpa pernah memanggil Nominatim,
 * lalu checkAttendanceLocation() jatuh ke jalur gagal-terbuka yang sudah ada.
 * ------------------------------------------------------------------ */

const NIM_DEMO = "60200122999";
const NIP_DEMO = "198501012010011001";
const ID_PESERTA_DEMO = 9001;
const ID_PEMBIMBING_DEMO = 7001;

const PROFIL_PESERTA = {
  id: ID_PESERTA_DEMO,
  nim: NIM_DEMO,
  nama: "Mahasiswa Demo",
  foto: "",
  tglLahir: "2003-05-17",
  prodi: "Teknik Informatika",
  fakultas: "Sains dan Teknologi",
  tahunMasuk: "2022",
  angkatan: "KKN Demo",
  kecamatan: "",
  kabupaten: "",
  poskoKoordinat: null,
  angkatanTanggalMulai: geser(-30),
  angkatanTanggalSelesai: geser(30),
  settingTanggalMulai: null,
  settingTanggalSelesai: null,
  angkatanId: 99,
  wilayahId: 99,
};

const PROFIL_PEMBIMBING = {
  nip: NIP_DEMO,
  nama: "Dosen Demo",
  foto: "",
  tglLahir: "1985-01-01",
  prodi: "Teknik Informatika",
  fakultas: "Sains dan Teknologi",
  angkatan: "KKN Demo",
  peran: "Dosen Pembimbing",
};

/** Riwayat LKH contoh: beberapa hari terisi, hari ini sengaja KOSONG supaya
 *  absensi bisa diperagakan langsung di depan penguji. */
const RIWAYAT_LKH = [
  { waktu: geser(-5), sinkron: 1 },
  { waktu: geser(-4), sinkron: 1 },
  { waktu: geser(-3), sinkron: 1 },
  { waktu: geser(-1), sinkron: 1 },
];

const MAHASISWA_BIMBINGAN = [
  { id: 9001, kode: NIM_DEMO, nama: "Mahasiswa Demo", foto: "" },
  { id: 9002, kode: "60200122001", nama: "Andi Pratama", foto: "" },
  { id: 9003, kode: "60200122002", nama: "Nurul Hikmah", foto: "" },
  { id: 9004, kode: "60200122003", nama: "Muhammad Fajar", foto: "" },
  { id: 9005, kode: "60200122004", nama: "Siti Aisyah", foto: "" },
];

/** Kehadiran per tanggal: dua dari lima mahasiswa sudah mengisi, supaya
 *  kalender dosen memperlihatkan keadaan "sebagian", bukan kosong semua. */
const KEHADIRAN = [
  { kode: "60200122001", lkh: 1 },
  { kode: "60200122002", lkh: 1 },
];

const TANGGAL_PEMBIMBING = {
  total_peserta: MAHASISWA_BIMBINGAN.length,
  list_tanggal: [
    { waktu: geser(-5), total: 5 },
    { waktu: geser(-4), total: 3 },
    { waktu: geser(-3), total: 5 },
    { waktu: geser(-2), total: 0 },
    { waktu: geser(-1), total: 2 },
    { waktu: geser(0), total: 2 },
  ],
};

/* ------------------------------------------------------------------ *
 * Penjaga jaringan
 * ------------------------------------------------------------------ */

const BERHASIL = { statusCode: 200, desc: "Berhasil" };

/** Jawaban per endpoint. Kunci dicocokkan dengan jalur TANPA query. */
function jawaban(jalur: string): unknown {
  switch (jalur) {
    case "/auth/get-token":
      return { ...BERHASIL, token: DEMO_TOKEN };

    case "/api/peserta":
      // Bentuk mentah server, bukan bentuk profil yang sudah dipetakan -
      // LoginScreen yang memetakannya, jadi di sini harus bentuk aslinya.
      return {
        ...BERHASIL,
        data: {
          id: ID_PESERTA_DEMO,
          kode: NIM_DEMO,
          nama: PROFIL_PESERTA.nama,
          foto: "",
          mhsTanggalLahir: PROFIL_PESERTA.tglLahir,
          mhsTahunAjaran: 2022,
          prodi: {
            nama: PROFIL_PESERTA.prodi,
            fakultas: { nama: PROFIL_PESERTA.fakultas },
          },
          angkatan: {
            id: PROFIL_PESERTA.angkatanId,
            nama_angkatan: PROFIL_PESERTA.angkatan,
            tanggal_mulai: PROFIL_PESERTA.angkatanTanggalMulai,
            tanggal_selesai: PROFIL_PESERTA.angkatanTanggalSelesai,
          },
          wilayahKec: null,
          wilayahKel: null,
        },
      };

    case "/api/lkh":
      return { ...BERHASIL, data: RIWAYAT_LKH };

    case "/api/simpan-lkh":
      return { ...BERHASIL, desc: "Berhasil" };

    case "/api/pembimbing":
      return {
        ...BERHASIL,
        data: {
          id: ID_PEMBIMBING_DEMO,
          kode: NIP_DEMO,
          nama: PROFIL_PEMBIMBING.nama,
          pegFoto: "",
          pegTglLahir: PROFIL_PEMBIMBING.tglLahir,
          prodi: {
            nama: PROFIL_PEMBIMBING.prodi,
            fakultas: { nama: PROFIL_PEMBIMBING.fakultas },
          },
          angkatan: { nama_angkatan: PROFIL_PEMBIMBING.angkatan },
          peran: { nama: PROFIL_PEMBIMBING.peran },
        },
      };

    case "/api/peserta-bimbing":
      return { ...BERHASIL, data: MAHASISWA_BIMBINGAN };

    case "/api/peserta-bimbing-lkh":
      return { ...BERHASIL, data: KEHADIRAN };

    case "/api/pembimbing-tanggal":
      return { ...BERHASIL, data: TANGGAL_PEMBIMBING };

    case "/api/lkh-check":
    case "/api/lkh-approved":
      return { ...BERHASIL };

    // Wajah: sesi demo memakai DEMO_TOKEN, dan faceServer.isUsableSession()
    // menolak token itu, jadi endpoint-endpoint ini sebenarnya tidak pernah
    // dipanggil. Dijawab juga supaya tidak ada jalur yang menggantung.
    case "/api/face-data":
      return { ...BERHASIL, data: { face_data: null } };
    case "/api/simpan-face-data":
    case "/api/reset-wajah":
    case "/api/simpan-reset":
      return { ...BERHASIL };
    case "/api/jumlah-reset":
      return { ...BERHASIL, data: { jumlah: 0 } };
    case "/api/max-reset":
      return { ...BERHASIL, data: { max_reset: 2 } };

    // Program presensi: dijawab dengan satu program siap pakai supaya
    // ensurePresensiProgramId() tidak perlu membuatnya.
    case "/api/program":
      return { ...BERHASIL, data: [{ id: 501, deskripsi: "Presensi harian." }] };
    case "/api/simpan-program":
      return { ...BERHASIL, data: { id: 501 } };

    default:
      return null;
  }
}

/** Respons tiruan. Dibentuk manual, bukan `new Response()`, supaya tidak
 *  bergantung pada polyfill fetch yang bisa berbeda antar platform. */
function respons(isi: unknown, status = 200): Response {
  const teks = JSON.stringify(isi);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    headers: { get: () => null } as unknown as Headers,
    url: "",
    text: async () => teks,
    json: async () => JSON.parse(teks),
  } as unknown as Response;
}

const tidur = (ms: number) => new Promise((lanjut) => setTimeout(lanjut, ms));

let sudahDipasang = false;

/**
 * Pasang penjaga di global.fetch. Dipanggil sekali saat aplikasi mulai.
 *
 * Permintaan ke server kampus dijawab dari data contoh; permintaan LAIN
 * (internal Expo, berkas, apa pun) diteruskan ke fetch aslinya. Jadi penjaga
 * ini memutus servernya saja, bukan seluruh jaringan.
 */
export function pasangPenjagaJaringan(): void {
  if (!MODE_LOKAL || sudahDipasang) return;
  sudahDipasang = true;

  const aslinya = global.fetch;

  global.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (!url.includes(HOST_KAMPUS)) {
      // Nominatim seharusnya tidak pernah dipanggil (posko sengaja null),
      // tapi kalau toh dipanggil, dijawab kosong supaya geofence jatuh ke
      // jalur gagal-terbuka alih-alih menunggu jaringan.
      if (url.includes("nominatim")) {
        await tidur(JEDA_MS);
        return respons([]);
      }
      return aslinya(input as RequestInfo, init);
    }

    // Jalur diambil sesudah host, supaya cocok untuk host kampus mana pun.
    const sesudahHost = url.slice(url.indexOf(HOST_KAMPUS) + HOST_KAMPUS.length);
    const jalur = sesudahHost.split("?")[0];
    const isi = jawaban(jalur);
    await tidur(JEDA_MS);

    if (isi === null) {
      // Endpoint yang belum punya data contoh dijawab 404 BER-JSON, bukan
      // dibiarkan ke jaringan. Pemanggil sudah menangani penolakan; yang
      // tidak ia tangani adalah menunggu timeout.
      return respons(
        { statusCode: 404, desc: `Mode lokal: ${jalur} tidak disediakan.` },
        404,
      );
    }
    return respons(isi);
  }) as typeof global.fetch;
}

/* ------------------------------------------------------------------ *
 * Login demo
 * ------------------------------------------------------------------ */

export type PeranDemo = "peserta" | "pembimbing";

/**
 * Buka sesi demo untuk salah satu peran. Menulis kunci sesi yang SAMA dengan
 * login asli (lihat LoginScreen), jadi seluruh layar sesudahnya tidak tahu
 * bedanya.
 *
 * Tokennya DEMO_TOKEN, dan itu disengaja: faceEnrollment.storageKeys()
 * memakai token ini untuk memilih ruang simpan "_demo", sehingga wajah yang
 * didaftarkan saat demo TIDAK menimpa data wajah akun asli Anda. Selain itu
 * faceServer.isUsableSession() menolak token ini, jadi tidak ada satu pun
 * embedding yang terkirim ke server kampus.
 */
export async function masukDemo(peran: PeranDemo): Promise<void> {
  const profil = peran === "pembimbing" ? PROFIL_PEMBIMBING : PROFIL_PESERTA;
  const kode = peran === "pembimbing" ? NIP_DEMO : NIM_DEMO;
  const id = peran === "pembimbing" ? ID_PEMBIMBING_DEMO : ID_PESERTA_DEMO;

  await AsyncStorage.multiSet([
    ["@user_token", DEMO_TOKEN],
    ["@user_nim", kode],
    ["@user_role", peran],
    ["@user_profile", JSON.stringify(profil)],
    ["@user_id", String(id)],
  ]);
}
