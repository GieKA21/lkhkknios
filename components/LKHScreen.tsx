import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { BlurView } from "expo-blur";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput } from "react-native-vision-camera";
// Sengaja TIDAK memakai <Camera> dari react-native-vision-camera-face-detector.
// Pembungkus itu memanggil useFaceDetectorOutput(), yang di v2.0.6 memo-nya
// rusak: `useMemo(..., [options])` sementara `options` adalah objek rest
// (`...options`) yang SELALU dibuat baru tiap render, sehingga output detektor
// tidak pernah stabil. VisionCamera membandingkan `outputs` per-elemen, jadi
// output yang berganti identitas memicu session.configure() -> unbindAll() di
// SETIAP render. Lihat catatan di faceDetectorOutput di bawah.
// Sejak 29 Oktober 2026 berlaku untuk iOS juga: di iPhone akibatnya force
// close pada absen kedua atau ketiga dalam satu kali buka aplikasi.
import { createFaceDetectorOutput } from "react-native-vision-camera-face-detector";
import type { Face } from "react-native-vision-camera-face-detector";
import {
    FACE_DETECTOR_OPTIONS,
    getFaceEmbedding,
    logSimilaritySample,
    MultipleFacesDetectedError,
    NoFaceDetectedError,
    PoorQualityFaceError,
    warmUpFaceModel,
  getFaceEmbeddingToleh,
  MIN_YAW_FOTO_TOLEH_DEG,
} from "../utils/faceAuthNative";
import {
    isEnrolled,
    syncEnrollmentFromServer,
} from "../utils/faceEnrollment";
import { decideAttendance, decideTurnedFace } from "../utils/verificationAgent";
import FaceEnrollmentModal from "./FaceEnrollmentModal";
import { useFaceQualityGate } from "../hooks/useFaceQualityGate";
import { useLivenessChallenge } from "../hooks/useLivenessChallenge";
import type { HasilPengikatan } from "../hooks/useLivenessChallenge";
import { scheduleDailyAttendanceReminders } from "../utils/notifications";
import {
    checkAttendanceLocation,
    formatJarak,
    LocationPermissionDeniedError,
    LocationUnavailableError,
    resolvePoskoLocation,
} from "../utils/geofence";
import { APP_VERSION, API_USER_AGENT, getDeviceInfoStr } from "../utils/deviceInfo";
import {
    API_BASE,
    getCachedProfilePhoto,
    profilePhotoHeaders,
    profilePhotoUrl,
} from "../utils/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type LKHStatus = "synced" | "unsynced" | "empty" | "today" | "none";

interface LKHRecord {
  date: string;
  status: LKHStatus;
  photoUri?: string;
  /** ID unik dibuat di device saat laporan diambil offline - dipakai supaya
   * retry sinkron ke /api/simpan-lkh tidak membuat duplikat di server. */
  kode?: string;
  /** "latitude,longitude" saat foto diambil, dikirim saat sinkron. */
  koordinat?: string;
  /** Program/kegiatan KKN yang dilaporkan. Server /api/simpan-lkh
   * mewajibkannya, tetapi UI presensi ini belum mengumpulkannya - lihat
   * catatan di syncOneRecord. */
  programId?: string | number;
  /** Deskripsi kegiatan harian. Sama seperti programId: diwajibkan server,
   * belum dikumpulkan UI. */
  deskripsi?: string;
}

interface UserData {
  nama: string;
  nim: string;
  prodi: string;
  fotoUrl: string;
  kecamatan: string | null;
  kabupaten: string | null;
  poskoKoordinat: string | null;
  // wilayahKec.setting.radius, dalam meter - lihat utils/geofence.ts.
  poskoRadius: number | null;
  // Dua sumber periode KKN dari server - lihat kknPeriod di bawah untuk
  // urutan prioritasnya.
  angkatanTanggalMulai: string | null;
  angkatanTanggalSelesai: string | null;
  settingTanggalMulai: string | null;
  settingTanggalSelesai: string | null;
}

/**
 * Kunci tanggal "YYYY-MM-DD" menurut zona waktu PERANGKAT.
 *
 * toISOString() sendiri selalu memakai UTC, jadi di WITA (UTC+8) tanggal
 * sebelum pukul 08:00 akan mundur satu hari. Menggeser dulu sebesar offset
 * zona waktu membuat hasilnya mengikuti tanggal yang dilihat pengguna.
 * Idiom ini sebelumnya disalin di delapan tempat pada file ini - satu saja
 * yang lupa digeser sudah cukup membuat absen tercatat di tanggal yang salah.
 */
function toDateKey(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

function generateLocalRecordCode(): string {
  // Kode unik anti-duplikat untuk retry: 40 heksadesimal + "@" + timestamp
  // milidetik, sesuai format `kode` yang diterima endpoint simpan-lkh.
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `${hex}@${Date.now()}`;
}

/**
 * Inisial 1-2 huruf dari nama, untuk avatar placeholder saat peserta tidak
 * punya foto profil (server mengirim foto:null) atau fotonya gagal dimuat -
 * jauh lebih rapi daripada lingkaran abu-abu kosong.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Jeda minimum antar-pemrosesan frame wajah di thread JS (~9x/detik).
 * Lihat komentar di handleCameraFaces: kamera mengirim frame jauh lebih
 * cepat dari yang dibutuhkan panduan di layar, dan setiap frame yang
 * diproses berarti setState + render ulang.
 */
const FACE_TICK_MS = 110;

/**
 * Batas umur PENGIKATAN IDENTITAS (lihat hooks/useLivenessChallenge.ts).
 *
 * Identitas diperiksa di dalam tantangan keaktifan, lalu pengguna menekan
 * shutter beberapa saat kemudian. Rentang di antara keduanya adalah jendela
 * yang tersisa untuk menukar wajah, jadi dibatasi: lewat dari ini, tantangan
 * harus diulang. 20 detik dipilih supaya pengguna sah yang sejenak ragu tidak
 * ikut tertolak - jarak wajar antara "silakan ambil foto" dan tombol ditekan
 * hanya beberapa detik.
 */
const PENGIKATAN_TTL_MS = 20_000;

// ===========================================================================
// SAKLAR UJI SEMENTARA - HARUS KEMBALI false SEBELUM BUILD APA PUN YANG
// DIPAKAI MENGUJI AKURASI ATAU DILAPORKAN DI NASKAH.
//
// Dipasang 4 Oktober 2026 hanya untuk menguji jalur kamera di luar periode
// KKN (periode angkatan berakhir 24 September 2026), setelah crash
// "PreviewView.previewOutput: Cannot cast dynamic to a jsi::Value type"
// diperbaiki lewat regenerasi proyek native.
//
// Yang dilewati HANYA gerbang tanggal. Gerbang lain - wajah terdaftar, izin
// kamera, geofence, tantangan keaktifan, dan ambang kemiripan - tidak
// disentuh sama sekali.
// ===========================================================================
/** Kompensasi pencahayaan kamera depan, dalam satuan EV (stop). Positif
 *  berarti lebih terang; +1 EV kira-kira menggandakan kecerahan terukurnya.
 *
 *  Dipasang karena fps 15 saja belum cukup di ruangan redup: dilaporkan dari
 *  iPhone bahwa preview sesekali anjlok sampai wajahnya tak terdeteksi, lalu
 *  pulih - dan selama bingkai gelap itu perintah tolehan tergantikan
 *  "Posisikan wajah dalam bingkai".
 *
 *  ANGKA INI SEBUAH TOMBOL PUTAR. Kalau di bawah cahaya terang wajahnya malah
 *  menjadi pucat dan mutunya gagal, turunkan ke 0,5. Kalau ruangan redup masih
 *  terlalu gelap, naikkan ke 1,5 - tetapi ubah SATU hal saja dalam satu kali
 *  uji, supaya ketahuan mana yang menolong. */
const KOMPENSASI_PENCAHAYAAN_EV = 1;

/** Saklar uji: true melewati pemeriksaan periode KKN sepenuhnya, sehingga
 *  absen dapat dicoba pada tanggal berapa pun.
 *
 *  HARUS false pada berkas yang diserahkan. Nilainya sempat true selama
 *  pengembangan supaya alur absen bisa diuji di luar jadwal KKN; dikembalikan
 *  ke false pada 10 Oktober 2026.
 *
 *  Mematikannya TIDAK memblokir siapa pun secara tak terduga: isWithinKKNPeriod
 *  tetap fail-open bila server belum mengirim tanggal periodenya, jadi yang
 *  terkunci hanyalah tanggal yang memang di luar periode menurut data server. */
const ABAIKAN_PERIODE_KKN = true; // HANYA cabang uji/periode-terbuka - jangan digabung

/** Saklar uji: true menampilkan sudut yaw wajah di pojok layar kamera.
 *
 *  Hanya untuk mengisi SISI_YAW_POSITIF di hooks/useLivenessChallenge.ts:
 *  penguji menoleh ke KANAN dirinya sendiri, lalu mencatat tanda angka yang
 *  tampil, sekali di iPhone dan sekali di Android.
 *
 *  HARUS false pada berkas yang diserahkan. Bukti build bersih: teks
 *  "yaw uji:" tidak ditemukan pada bundel JS-nya. */
const TAMPILKAN_YAW = false;

/**
 * Ukuran lingkaran status tanggal dalam PIKSEL TETAP (bukan persen). Di Android
 * New Architecture (Fabric), View ber-width/height persen + borderRadius besar
 * kadang dirender sebagai kotak-membulat, bukan lingkaran - itulah sebab hari
 * terisi tampak kotak sementara "hari ini" bulat. Ukuran px + borderRadius
 * setengahnya menjamin lingkaran sempurna & seragam.
 *
 * Perhitungan: lebar grid = lebar layar - padding scroll (16*2) - padding card
 * (18*2); tiap sel = 1/7 grid; lingkaran ~78% sel (menyisakan jarak antar sel).
 */
const DAY_CIRCLE_SIZE = Math.floor(
  ((Dimensions.get("window").width - 68) / 7) * 0.78,
);

export default function LKHScreen() {
  const [userData, setUserData] = useState<UserData>({
    nama: "Memuat...",
    nim: "",
    prodi: "",
    fotoUrl: "https://uin-alauddin.ac.id/assets/img/logo-uin-alauddin.png",
    kecamatan: null,
    kabupaten: null,
    poskoKoordinat: null,
    poskoRadius: null,
    angkatanTanggalMulai: null,
    angkatanTanggalSelesai: null,
    settingTanggalMulai: null,
    settingTanggalSelesai: null,
  });

  const [token, setToken] = useState<string>("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [records, setRecords] = useState<{ [key: string]: LKHRecord }>({});
  // Catatan absen dimuat secara asinkron, dan sampai selesai records masih {}
  // sehingga alreadyAttendedToday terbaca false. Berpindah cepat dari Profil
  // ke LKH menangkap jendela itu: tombol absen sempat hidup walau hari ini
  // SUDAH absen, dan bisa tertekan. Pola yang dipakai sama dengan
  // isCheckingEnrollment: tombol terkunci sampai statusnya pasti.
  const [isCheckingRecords, setIsCheckingRecords] = useState(true);

  // Periode KKN dihitung dari data server, bukan tanggal hardcode. Server
  // punya dua sumber: per lokasi/kecamatan (wilayahKec.setting - lebih
  // akurat karena tiap posko bisa mulai beda tanggal, tapi field ini sering
  // kosong kalau admin belum isi) dan per angkatan (lebih umum, fallback).
  // Kalau keduanya kosong, cek periode fail-open (dianggap selalu dalam
  // periode) - lebih baik daripada memblokir absen mahasiswa yang datanya
  // memang belum lengkap di server.
  const kknPeriod = useMemo(() => {
    const parseServerDate = (value: string | null): Date | null => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const start =
      parseServerDate(userData.settingTanggalMulai) ??
      parseServerDate(userData.angkatanTanggalMulai);
    const end =
      parseServerDate(userData.settingTanggalSelesai) ??
      parseServerDate(userData.angkatanTanggalSelesai);

    return { start, end };
  }, [
    userData.settingTanggalMulai,
    userData.settingTanggalSelesai,
    userData.angkatanTanggalMulai,
    userData.angkatanTanggalSelesai,
  ]);

  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraDevice = useCameraDevice("front");
  // targetResolution default-nya usePhotoOutput() adalah UHD_4_3 (3024x4032,
  // rasio 3:4, ~12MP). Preview di layar full-screen (StyleSheet.absoluteFillObject,
  // rasio ramping ~9:19.5 di iPhone), jauh berbeda dari 4:3 - meminta resolusi
  // foto dengan rasio sejauh itu dari preview bisa membuat iOS memilih format
  // capture yang field-of-view-nya beda dari yang dipakai live preview (foto
  // hasil jepretan jadi "zoom" dibanding apa yang terlihat di preview, sampai-
  // sampai wajah tidak lagi utuh dalam frame dan MLKit gagal mendeteksinya).
  // FHD_16_9 dipakai karena rasio 9:16-nya jauh lebih dekat ke bentuk preview,
  // dan resolusinya (1080x1920) sudah jauh lebih dari cukup untuk model
  // MobileFaceNet yang inputnya cuma 112x112.
  // config & outputs dimemo agar referensinya stabil (diminta dokumentasi
  // VisionCamera); penyebab kedip/gelap ditangani lewat constraints + throttle.
  //
  // iOS: stabil SELAMA satu kali kamera dibuka, tetapi BARU setiap kali
  // kamera dibuka (sesiKamera naik di handleOpenAttendanceCamera). Di iOS
  // kamera ada di dalam <Modal>, jadi setiap absen membuat AVCaptureSession
  // baru, sedangkan VisionCamera tidak pernah melepas sesi lama - ia hanya
  // stop() lalu configure([]), dan pada sesi yang sudah berhenti pelepasan
  // output itu ditunda AVFoundation sampai sesinya di-dealloc. Sesi lama baru
  // di-dealloc belakangan, bersama preview layer-nya, dan saat itu ia
  // melepas output yang SUDAH dipasang di sesi baru: assert di
  // -[AVCaptureOutput detachFromFigCaptureSession:] -> SIGABRT. Log crash
  // build 55 dan 56 sama persis. Dengan output baru per sesi, output milik
  // sesi lama tidak pernah dipakai sesi lain. Android tetap satu output
  // seumur layar (sesiKamera tidak naik di sana).
  const [sesiKamera, setSesiKamera] = useState(0);
  const photoConfig = useMemo(
    // Salinan objek resolusi, bukan konstanta yang sama: usePhotoOutput
    // memo-nya bergantung pada identitas targetResolution, jadi salinan
    // baru inilah yang membuatnya membuat output baru.
    () => ({ targetResolution: { ...CommonResolutions.FHD_16_9 } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sesiKamera],
  );
  const photoOutput = usePhotoOutput(photoConfig);
  // cameraOutputs dibentuk SETELAH handleCameraFaces (butuh output detektor
  // wajah yang stabil) - lihat faceDetectorOutput di bawah.
  // PREVIEW GELAP: saat detektor wajah aktif, iOS membatasi exposure ke 1
  // durasi frame (1/30 dtk @30fps), jadi preview lebih gelap. 15fps
  // menggandakan batas exposure (2x lebih terang) & memangkas separuh callback
  // onFacesDetected ke thread JS - tantangan gerak kepala tak butuh 30fps.
  // iOS SAJA. Di Android, memaksa fps mengharuskan VisionCamera menemukan
  // format yang mendukungnya persis; kalau tidak ada, sesi kamera gagal
  // dikonfigurasi dan preview tinggal HITAM. Biarkan Android memilih sendiri.
  // setExposureBias MELEMPAR galat bila perangkatnya tidak mendukung bias
  // atau nilainya di luar rentang, jadi keduanya diperiksa di sini. iOS saja:
  // Android tidak mengalami gejalanya, dan mencerahkannya di sana hanya
  // berisiko membuat wajah pucat tanpa menyelesaikan apa pun.
  const biasPencahayaan = useMemo(() => {
    if (Platform.OS !== "ios") return undefined;
    if (!cameraDevice?.supportsExposureBias) return undefined;
    return Math.min(KOMPENSASI_PENCAHAYAAN_EV, cameraDevice.maxExposureBias);
  }, [cameraDevice]);

  const cameraConstraints = useMemo(
    () => (Platform.OS === "ios" ? [{ fps: 15 }] : undefined),
    [],
  );
  const faceQualityGate = useFaceQualityGate();

  // Kapan identitas terakhir kali terikat ke tantangan keaktifan (epoch ms),
  // null bila belum ada. Dibaca takeSelfie untuk menolak pengikatan yang sudah
  // basi - lihat PENGIKATAN_TTL_MS.
  const pengikatanAtRef = useRef<number | null>(null);

  /**
   * PENGIKATAN IDENTITAS - dipanggil hook liveness saat pengguna menghadap
   * tengah sesudah kedua tolehan selesai.
   *
   * Mengambil satu foto diam-diam lalu memeriksa apakah wajah yang SEDANG
   * mengerjakan tantangan benar-benar pemilik akun. Inilah yang menutup
   * serangan "teman menoleh, lalu foto korban disodorkan saat menjepret":
   * wajah teman gugur di sini dan tidak pernah membuka tombol shutter.
   *
   * Kegagalan MUTU dibedakan dari kegagalan IDENTITAS. Mata terpejam atau
   * wajah blur hanya meminta pengguna menghadap tengah sekali lagi; yang
   * mengulang tantangan dari awal hanyalah wajah yang memang bukan pemiliknya.
   */
  const handleBindIdentity = useCallback(async (): Promise<HasilPengikatan> => {
    try {
      // enableShutterSound: false - jepretan ini TIDAK diminta pengguna, ia
      // bagian dalam dari tantangan keaktifan. Membunyikan rana di sini
      // membuat satu kali absen terdengar memotret beberapa kali dan
      // membingungkan. Bunyi rana tetap menyala pada foto absen yang
      // sesungguhnya di takeSelfie, karena di sana memang ada umpan balik
      // yang berguna. Catatan API: sebagian wilayah memaksa bunyi rana di
      // tingkat sistem, jadi ini permintaan, bukan jaminan.
      const photoFile = await photoOutput.capturePhotoToFile(
        { enableShutterSound: false },
        {},
      );
      const photoUri = `file://${photoFile.filePath}`;

      let embedding: Float32Array;
      try {
        embedding = await getFaceEmbedding(photoUri);
      } catch (error) {
        // Semua galat pembacaan wajah diperlakukan sebagai soal mutu: pada
        // titik ini pengguna sedang bergerak, jadi wajar sesekali meleset.
        if (
          error instanceof NoFaceDetectedError ||
          error instanceof MultipleFacesDetectedError ||
          error instanceof PoorQualityFaceError
        ) {
          return "ulangi";
        }
        throw error;
      }

      const verdict = await decideAttendance(embedding);
      if (verdict.kind === "not-enrolled") {
        // Set wajah hilang di tengah jalan (mis. di-reset dari Profil).
        setIsCameraVisible(false);
        setIsEnrollmentVisible(true);
        return "gagal";
      }
      if (verdict.kind === "rejected") {
        pengikatanAtRef.current = null;
        Alert.alert(
          "Wajah Tidak Cocok",
          `Wajah yang mengerjakan tantangan tidak cocok dengan wajah terdaftar ` +
            `pada akun ini (kemiripan ${(verdict.similarity * 100).toFixed(2)}%). ` +
            `Absensi harus dikerjakan oleh pemilik akun.`,
        );
        return "gagal";
      }

      pengikatanAtRef.current = Date.now();
      return "ok";
    } catch (error) {
      console.error("Gagal mengikat identitas pada tantangan keaktifan", error);
      return "ulangi";
    }
    // photoOutput hanya berganti saat kamera dibuka ulang (lihat
    // photoConfig), jadi selama kamera terbuka referensi callback ini stabil -
    // penting, karena ia ikut menentukan stabilitas onFacesDetected dan
    // karenanya konfigurasi sesi kamera.
  }, [photoOutput]);

  // Hasil pemeriksaan wajah menoleh, hanya ditampilkan bila TAMPILKAN_YAW.
  const [ikatUji, setIkatUji] = useState<string | null>(null);

  /**
   * PENGIKATAN IDENTITAS PADA TOLEHAN TERAKHIR - dipanggil hook liveness
   * selagi pengguna masih menahan kepalanya menoleh. Alasannya di
   * jalankanIkatToleh (hooks/useLivenessChallenge.ts): tanpa ini, tolehan
   * dapat dikerjakan orang lain lalu diganti foto pemilik di layar HP.
   *
   *   "ulangi" - foto tidak terpakai: wajahnya sudah lurus kembali saat
   *              terpotret, atau kurang jelas. Tolehan terakhir diulang.
   *   "gagal"  - wajah yang menoleh BUKAN pemilik akun.
   */
  const handleTurnBind = useCallback(async (): Promise<HasilPengikatan> => {
    try {
      const photoFile = await photoOutput.capturePhotoToFile(
        { enableShutterSound: false },
        {},
      );
      let hasil: { embedding: Float32Array; yaw: number };
      try {
        hasil = await getFaceEmbeddingToleh(`file://${photoFile.filePath}`);
      } catch (error) {
        if (
          error instanceof NoFaceDetectedError ||
          error instanceof MultipleFacesDetectedError ||
          error instanceof PoorQualityFaceError
        ) {
          if (TAMPILKAN_YAW) setIkatUji(`ikat toleh: ulangi (${error.message.slice(0, 40)})`);
          return "ulangi";
        }
        throw error;
      }
      if (Math.abs(hasil.yaw) < MIN_YAW_FOTO_TOLEH_DEG) {
        if (TAMPILKAN_YAW) setIkatUji(`ikat toleh: ulangi (yaw foto ${Math.round(hasil.yaw)})`);
        return "ulangi";
      }

      const verdict = await decideTurnedFace(hasil.embedding);
      if (verdict.kind === "not-enrolled") {
        setIsCameraVisible(false);
        setIsEnrollmentVisible(true);
        return "gagal";
      }
      if (TAMPILKAN_YAW) {
        setIkatUji(
          `ikat toleh: ${verdict.similarity.toFixed(3)} ${verdict.kind === "accepted" ? "lolos" : "TOLAK"} (yaw foto ${Math.round(hasil.yaw)})`,
        );
      }
      if (verdict.kind === "rejected") {
        pengikatanAtRef.current = null;
        Alert.alert(
          "Wajah Tidak Cocok",
          `Wajah yang menoleh tidak cocok dengan wajah terdaftar pada akun ini ` +
            `(kemiripan ${(verdict.similarity * 100).toFixed(2)}%). ` +
            `Absensi harus dikerjakan oleh pemilik akun.`,
        );
        return "gagal";
      }
      return "ok";
    } catch (error) {
      console.error("Gagal mengikat identitas pada tolehan terakhir", error);
      return "ulangi";
    }
  }, [photoOutput]);

  // Deteksi keaktifan: shutter absen terkunci sampai pengguna menyelesaikan
  // tantangan gerak (menoleh dua sisi) DAN identitasnya terbukti pemilik akun
  // - pada tolehan terakhir dan lagi pada wajah lurus. Lihat
  // hooks/useLivenessChallenge.ts.
  const liveness = useLivenessChallenge(handleBindIdentity, handleTurnBind);
  // Satu callback menyuapi frame ke quality gate DAN liveness (keduanya baca
  // yaw/bounds yang sama). onFacesDetected dipanggil per-frame di thread JS &
  // tiap hook memanggil setState; tanpa throttle, komponen ini dirender ulang
  // puluhan kali/detik - UI tersendat & memperbesar peluang SIGSEGV (MLKit-iOS
  // di iOS 26). Dibatasi ~9x/detik: masih jauh lebih cepat dari gerak kepala
  // (~1 dtk/tolehan), yaw tetap tertangkap mulus.
  const lastFaceTickRef = useRef(0);
  const [yawUji, setYawUji] = useState<number | null>(null);
  const handleCameraFaces = useCallback(
    (faces: Face[]) => {
      const now = Date.now();
      if (now - lastFaceTickRef.current < FACE_TICK_MS) return;
      lastFaceTickRef.current = now;
      if (TAMPILKAN_YAW && faces?.length === 1) {
        setYawUji(Math.round(faces[0].yawAngle));
      }
      faceQualityGate.onFacesDetected(faces);
      liveness.onFacesDetected(faces);
    },
    // Kedua callback sudah di-useCallback([]) di dalam hook-nya (stabil);
    // merujuk membernya di sini aman, linter cuma tak bisa memverifikasinya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceQualityGate.onFacesDetected, liveness.onFacesDetected],
  );

  // OUTPUT DETEKTOR WAJAH YANG STABIL - ini inti perbaikan "preview hitam" di
  // Android.
  //
  // Gejalanya: preview hitam, foto gagal dengan
  //   ImageCaptureException: Camera is closed
  //     ... ProcessCameraProvider.unbindAll(...)
  //     ... HybridCameraSession$configure$1.invokeSuspend
  // padahal deteksi wajah & tantangan keaktifan tetap berjalan.
  //
  // Sebabnya BUKAN pengambilan fotonya, melainkan sesi kamera yang
  // dikonfigurasi ULANG terus-menerus: VisionCamera membandingkan `outputs`
  // per-elemen (useMemoizedArray), dan useFaceDetectorOutput() v2.0.6
  // mengembalikan output baru di SETIAP render karena dependensi memo-nya
  // adalah objek rest yang selalu baru. Tiap render -> configure() ->
  // unbindAll() -> preview dirobohkan & permintaan jepret dibatalkan. Karena
  // panduan di layar meng-setState ~9x/detik (FACE_TICK_MS), sesi praktis
  // tidak pernah sempat hidup. Analisis frame tetap jalan, itu sebabnya
  // deteksi wajah terlihat normal dan onError kamera tak pernah menyala.
  //
  // Maka output dibuat SEKALI per kali kamera dibuka (deps [sesiKamera])
  // memakai API publik createFaceDetectorOutput(), dengan callback dialirkan
  // lewat ref supaya identitas outputnya tidak berubah meski komponen render
  // ulang.
  const facesCallbackRef = useRef(handleCameraFaces);
  facesCallbackRef.current = handleCameraFaces;
  const cameraErrorRef = useRef(faceQualityGate.onFaceDetectionError);
  cameraErrorRef.current = faceQualityGate.onFaceDetectionError;
  // KEDUA PLATFORM, sejak 29 Oktober 2026. Sebelumnya iOS memakai
  // <FaceDetectorCamera>, yang membuat output baru di setiap render seperti
  // dijelaskan di atas. Di iOS gejalanya bukan preview hitam melainkan force
  // close: setiap output membawa detektor MLKit, antrean, dan
  // AVCaptureVideoDataOutput sendiri, sehingga ~9 objek native per detik
  // menumpuk selama tantangan dan dilepas bersamaan saat kamera ditutup -
  // ada yang dilepas ketika MLKit masih memproses bingkai. Aplikasi selalu
  // tertutup pada absen kedua atau ketiga dalam satu kali buka, tepat saat
  // dialog hasil muncul (pengujian build 55).
  //
  // outputResolution "preview" hanya untuk iOS, menyamakan nilai bawaan
  // pembungkus yang dipakai sebelumnya; Android dibiarkan seperti semula.
  const faceDetectorOutput = useMemo(
    () =>
      createFaceDetectorOutput({
        onFacesDetected: (faces) => facesCallbackRef.current(faces),
        onError: (error) => cameraErrorRef.current(error),
        ...(Platform.OS === "ios" ? { outputResolution: "preview" as const } : {}),
        performanceMode: "fast",
        // DIAGNOSTIK (dipertahankan dari sebelumnya): landmark &
        // classification live dimatikan untuk menghindari crash SIGSEGV MLKit
        // di iOS 26. TIDAK memengaruhi pipeline foto still di
        // utils/faceAuthNative.ts, yang tetap memakai FACE_DETECTOR_OPTIONS
        // lengkap saat enroll/verify.
        runLandmarks: false,
        runClassifications: false,
        minFaceSize: FACE_DETECTOR_OPTIONS.minFaceSize,
      }),
    // sesiKamera: baru setiap kali kamera dibuka di iOS, alasannya sama
    // dengan photoConfig di atas. Tetap stabil selama kamera terbuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sesiKamera],
  );
  const cameraOutputs = useMemo(
    () => [faceDetectorOutput, photoOutput],
    [faceDetectorOutput, photoOutput],
  );

  const insets = useSafeAreaInsets();
  const [isCameraVisible, setIsCameraVisible] = useState(false);

  // ANDROID SAJA - "preview hitam yang sebenarnya hidup".
  // Gambarnya sudah mengalir (deteksi wajah jalan, foto hasil jepretan benar),
  // tetapi permukaan preview tidak pernah digambar ke layar sampai ada sesuatu
  // yang memaksa jendela menggambar ulang - terbukti karena preview baru
  // muncul begitu dialog error tampil di atasnya. Maka setelah aliran preview
  // benar-benar mulai (onPreviewStarted), tinggi view digeser 1px agar terjadi
  // satu layout pass sehingga permukaannya ikut tergambar. Timer 600ms adalah
  // jaring pengaman bila onPreviewStarted tidak menyala.
  const [previewStarted, setPreviewStarted] = useState(false);
  // Mode render preview Android. Tombol pengubahnya dilepas bersama lapisan
  // diagnostik, tetapi nilainya tetap dibaca prop implementationMode -
  // dibiarkan sebagai state supaya mudah dinyalakan lagi bila suatu saat
  // ada perangkat yang menuntut TextureView.
  const [useTextureView] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!isCameraVisible) {
      setPreviewStarted(false);
      return;
    }
    // TIDAK ADA timer cadangan di sini. Versi sebelumnya menyalakan penanda
    // setelah 600 ms tanpa peduli apakah onPreviewStarted benar-benar menyala,
    // sehingga penanda selalu menulis "mulai" dan menyembunyikan fakta bahwa
    // aliran preview tidak pernah berjalan. Diagnostik yang berbohong lebih
    // buruk daripada tidak ada diagnostik.
  }, [isCameraVisible]);
  // Enrollment terpisah (FaceEnrollmentModal) - terbuka saat user mencoba
  // absen tanpa punya set wajah terdaftar. Menggantikan jalur lama di mana
  // foto absen pertama diam-diam menjadi wajah patokan.
  const [isEnrollmentVisible, setIsEnrollmentVisible] = useState(false);
  // Koordinat device saat lolos cek geofence terakhir kali kamera dibuka -
  // dipakai ulang saat foto benar-benar disimpan (persistAttendance) supaya
  // tidak perlu minta GPS dua kali dalam rentang beberapa detik yang sama.
  const pendingCoordinatesRef = useRef<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Wajah patokan (baseline) yang direkam pertama kali lewat tombol absensi,
  // dipakai untuk memverifikasi bahwa setiap absen berikutnya adalah orang
  // yang sama (mencegah titip absen). Verifikasi dijalankan sekali saat foto
  // benar-benar diambil (lihat takeSelfie) - bukan terus-menerus selama
  // kamera terbuka, karena menjalankan model AI berulang kali sambil live
  // preview kamera aktif terbukti bikin aplikasi force close di beberapa HP.
  const [hasEnrollment, setHasEnrollment] = useState(false);
  // Selama sync wajah dari server masih berjalan di perangkat BARU, JANGAN
  // tampilkan "Daftarkan Wajah": wajahnya mungkin sudah ada di server dan belum
  // sempat ditarik, sehingga user salah kira harus mendaftar ulang. Default
  // true, dimatikan begitu status wajah pasti (dari cache lokal ATAU setelah
  // sync server selesai).
  const [isCheckingEnrollment, setIsCheckingEnrollment] = useState(true);
  const [isProcessingFace, setIsProcessingFace] = useState(false);
  // DIAGNOSTIK SEMENTARA: menampilkan foto hasil jepretan apa adanya saat
  // deteksi wajah gagal, supaya bisa dilihat langsung (miring/gelap/
  // terpotong?) tanpa perlu Console.app. Hapus setelah root cause ketemu.
  const [debugPhotoUri, setDebugPhotoUri] = useState<string | null>(null);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  // URI foto profil yang TERBUKTI gagal dimuat (404 / jaringan) - render jatuh
  // ke avatar inisial alih-alih lingkaran kosong.
  //
  // Sengaja menyimpan URI-nya, bukan boolean. Layar ini di-mount ULANG setiap
  // pindah tab (app/(tabs)/index.tsx merender bersyarat, bukan memakai
  // navigator), dan fotoUrl berganti dari URL remote ke berkas lokal di tengah
  // jalan. Dengan boolean, onError milik URL LAMA yang datang terlambat ikut
  // mematikan URI BARU yang sebenarnya sehat, dan karena efeknya cuma jalan
  // saat mount tidak ada yang meresetnya - avatar terkunci jadi inisial.
  const [failedPhotoUri, setFailedPhotoUri] = useState<string | null>(null);
  // Guard agar sinkron-otomatis (pengganti tombol manual) hanya dicoba sekali
  // per sesi layar, bukan tiap render / saat sebagian gagal.
  const autoSyncTriedRef = useRef(false);

  // Sengaja cuma jalan sekali saat mount (bukan menambahkan loadUserProfile
  // dkk ke dependency array) - fungsi-fungsi itu tidak dibungkus useCallback
  // dan referensinya berubah tiap render, jadi menurutinya malah membuat
  // efek ini jalan berulang.
  useEffect(() => {
    // Cache lokal dibaca lebih dulu (tanpa jaringan) supaya status "sudah
    // absen" diketahui hampir seketika; tarikan server di bawah menyusul dan
    // menimpanya kalau berbeda.
    AsyncStorage.getItem("@lkh_records")
      .then((stored) => {
        if (!stored) return;
        setRecords(JSON.parse(stored));
        setIsCheckingRecords(false);
      })
      .catch(() => {});
    loadUserProfile().then(() => {
      // Bersihkan dulu catatan bekas Mode Demo (fitur demo kini dihapus total)
      // SEBELUM menarik dari server, supaya tanggal yang cuma "demo" tidak lagi
      // tampil ungu dan mengikuti status server apa adanya (mis. merah).
      purgeDemoRecords().finally(() =>
        fetchServerLKH().finally(() => setIsCheckingRecords(false)),
      );
    });
    // Wajah terdaftar kini tinggal di server (lihat utils/faceEnrollment.ts).
    // Selaraskan dulu supaya instalasi baru / perangkat baru langsung
    // mengenali wajah yang sudah didaftarkan sebelumnya, baru baca hasilnya.
    // syncEnrollmentFromServer() tidak pernah melempar - kalau server tidak
    // terjangkau, cache lokal yang dipakai.
    // Cek cache lokal dulu (cepat) supaya perangkat LAMA yang sudah punya
    // wajah tersimpan langsung tahu statusnya tanpa menunggu jaringan; lalu
    // selaraskan dengan server dan cek ulang. isCheckingEnrollment baru
    // dimatikan saat status pasti - mencegah "Daftarkan Wajah" berkedip di
    // perangkat BARU selama sync server masih berjalan.
    isEnrolled().then((local) => {
      setHasEnrollment(local);
      if (local) setIsCheckingEnrollment(false);
    });
    syncEnrollmentFromServer().finally(() => {
      isEnrolled().then((enrolled) => {
        setHasEnrollment(enrolled);
        setIsCheckingEnrollment(false);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jadwalkan ulang notifikasi pengingat absen (10:00 & 20:00) setiap kali
  // data laporan berubah - otomatis dibatalkan begitu hari ini sudah absen,
  // ATAU begitu periode KKN lewat.
  //
  // kknPeriod ikut jadi dependensi, bukan hanya records: periodenya datang
  // dari profil server dan bisa terisi SESUDAH render pertama. Tanpa itu,
  // penjadwalan pertama memakai periode kosong - yang dianggap fail-open -
  // dan pengingatnya terlanjur terpasang untuk hari itu.
  useEffect(() => {
    scheduleDailyAttendanceReminders(
      !!records[toDateKey(new Date())],
      isWithinKKNPeriod(new Date()),
    ).catch(() => {});
    // isWithinKKNPeriod SENGAJA tidak masuk daftar dependensi. Ia dideklarasikan
    // jauh di bawah efek ini sebagai `const`, sedangkan daftar dependensi
    // dievaluasi saat render pada baris ini juga - menyebutkannya di situ
    // melempar "Cannot access before initialization" dan aplikasinya mati saat
    // dibuka. Memanggilnya di DALAM badan efek aman, karena badan efek baru
    // berjalan sesudah seluruh komponen selesai dirender. Satu-satunya yang
    // dibacanya dan bisa berubah adalah kknPeriod, dan itu sudah didaftarkan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, kknPeriod]);

  // Sinkron OTOMATIS senyap: begitu ada laporan offline yang belum terkirim,
  // coba kirim sekali di latar (tanpa modal/alert), di samping tombol manual.
  // Guard ref mencegah pengulangan tiap render.
  useEffect(() => {
    const hasUnsynced = Object.values(records).some(
      (r) => r.status === "unsynced",
    );
    if (hasUnsynced && !autoSyncTriedRef.current) {
      autoSyncTriedRef.current = true;
      handleSync(true).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  const loadUserProfile = async () => {
    try {
      const profileJson = await AsyncStorage.getItem("@user_profile");
      const savedToken = await AsyncStorage.getItem("@user_token");

      if (savedToken) setToken(savedToken);

      if (profileJson) {
        const data = JSON.parse(profileJson);
        // Server bisa mengirim foto:null (peserta belum punya foto profil).
        // Jangan paksa nama file default yang bukan miliknya - itu berujung
        // 404 lalu lingkaran kosong. Tanpa foto, fotoUrl dikosongkan dan
        // render menampilkan avatar inisial.
        const dbFotoUrl = data.foto ? profilePhotoUrl(data.foto) : "";
        setFailedPhotoUri(null);

        // Di iOS fotoUrl SENGAJA dikosongkan dulu, bukan diisi URL remote.
        // Tarikan remote di iOS hampir selalu ditolak (endpoint di balik WAF +
        // butuh token), dan onError-nya datang setelah berkas lokal terpasang
        // - itu akar bug "foto hilang setelah pindah tab". Berkas lokal hasil
        // cache dipasang di bawah; kalau cache gagal, barulah URL remote
        // dipakai sebagai cadangan.
        const fotoAwal = Platform.OS === "ios" ? "" : dbFotoUrl;

        setUserData({
          nama: data.nama,
          nim: data.nim,
          prodi: data.prodi,
          fotoUrl: fotoAwal,
          kecamatan: data.kecamatan || null,
          kabupaten: data.kabupaten || null,
          poskoKoordinat: data.poskoKoordinat || null,
          // Profil dari login sebelum radius ikut disimpan tidak punya field
          // ini; geofence lalu memakai cadangannya sampai pengguna login ulang.
          poskoRadius:
            typeof data.poskoRadius === "number" ? data.poskoRadius : null,
          angkatanTanggalMulai: data.angkatanTanggalMulai || null,
          angkatanTanggalSelesai: data.angkatanTanggalSelesai || null,
          settingTanggalMulai: data.settingTanggalMulai || null,
          settingTanggalSelesai: data.settingTanggalSelesai || null,
        });

        // iOS SAJA: unduh foto SEKALI ke berkas lokal lalu tampilkan dari lokal.
        // Di iOS <Image> menarik ULANG foto dari URL remote tiap layar di-mount,
        // dan penarikan berulang itu sering gagal (endpoint di balik WAF + butuh
        // token) -> foto berkedip jadi inisial. Berkas lokal tampil andal. Di
        // Android URL remote sudah bekerja & di-cache dengan andal, jadi tak
        // diubah. Kalau unduh gagal, URL remote (di atas) jadi fallback.
        if (Platform.OS === "ios" && dbFotoUrl && savedToken) {
          getCachedProfilePhoto(dbFotoUrl, savedToken).then((localUri) => {
            // Cache gagal -> jatuh ke URL remote, biar tetap ada peluang tampil.
            const uri = localUri || dbFotoUrl;
            setFailedPhotoUri(null);
            setUserData((prev) => ({ ...prev, fotoUrl: uri }));
          });
        }
      }
    } catch (e) {
      console.error("Gagal membaca data profil", e);
    }
  };

  // Migrasi satu kali: buang catatan absen bekas "Mode Demo". Dulu ada Mode
  // Demo (kini dihapus total) - absen yang diambil saat mode itu aktif ditandai
  // isDemo, TIDAK PERNAH dikirim ke server, tapi tetap tersimpan lokal dan
  // tampil ungu ("Uji Coba/Demo") di kalender. Ada pula bug lama: setelah
  // mematikan demo, absen normal berikutnya di tanggal yang sama ikut mewarisi
  // tag demo sehingga terhitung demo walau seharusnya absen biasa. Karena
  // catatan demo tak pernah ada di server, membuangnya membuat tanggal itu
  // tampil apa adanya dari server (mis. merah "Tidak Mengisi") - persis seperti
  // di perangkat lain yang tak pernah kena mode demo.
  const purgeDemoRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem("@lkh_records");
      if (!stored) return;
      const parsed = JSON.parse(stored);
      let changed = false;
      for (const key of Object.keys(parsed)) {
        if (parsed[key]?.isDemo) {
          delete parsed[key];
          changed = true;
        }
      }
      if (changed) {
        await AsyncStorage.setItem("@lkh_records", JSON.stringify(parsed));
      }
    } catch (e) {
      console.error("Gagal membersihkan catatan demo lama", e);
    }
  };

  const fetchServerLKH = async () => {
    try {
      const currentToken = await AsyncStorage.getItem("@user_token");
      const nim = await AsyncStorage.getItem("@user_nim");
      if (!currentToken || !nim) return;

      const url = `${API_BASE}/api/lkh?nim=${nim}&device_info=${getDeviceInfoStr()}&version=${APP_VERSION}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          "User-Agent": API_USER_AGENT,
          "Accept-Encoding": "gzip",
        },
      });

      const text = await response.text();

      // PERBAIKAN: Cek apakah response berupa HTML (Sesi Expired)
      if (text.trim().startsWith("<")) {
        console.log("Sesi expired atau server mengembalikan HTML.");
        // Ambil dari lokal saja
        const stored = await AsyncStorage.getItem("@lkh_records");
        if (stored) setRecords(JSON.parse(stored));
        return;
      }

      const result = JSON.parse(text);

      if (result.statusCode === 200 && Array.isArray(result.data)) {
        const stored = await AsyncStorage.getItem("@lkh_records");
        const previousLocal: { [key: string]: LKHRecord } = stored
          ? JSON.parse(stored)
          : {};

        // Server adalah sumber kebenaran: hasil akhir dibangun mulai dari
        // data server, bukan ditumpuk di atas cache lokal lama seperti
        // sebelumnya. Sebelumnya entri lokal yang sudah tidak ada di server
        // tidak pernah dibersihkan, jadi tanggal yang sebenarnya kosong bisa
        // tetap kelihatan "terabsen" selamanya (misal sisa dari testing).
        // Entri lokal cuma dipertahankan kalau statusnya masih "unsynced" -
        // laporan yang baru diambil offline dan server memang belum tahu
        // soal itu, bukan sisa data lama.
        const merged: { [key: string]: LKHRecord } = {};

        result.data.forEach((item: any) => {
          if (!item.waktu) return;
          const existing = previousLocal[item.waktu];
          merged[item.waktu] = {
            date: item.waktu,
            status: item.sinkron === 1 ? "synced" : "unsynced",
            // Server tidak mengirim balik file foto/kode - dipertahankan
            // dari cache lokal kalau ada supaya tetap bisa ditampilkan.
            photoUri: existing?.photoUri,
            kode: existing?.kode,
            koordinat: existing?.koordinat,
          };
        });

        Object.keys(previousLocal).forEach((dateKey) => {
          if (merged[dateKey]) return;
          if (previousLocal[dateKey].status === "unsynced") {
            merged[dateKey] = previousLocal[dateKey];
          }
        });

        await AsyncStorage.setItem("@lkh_records", JSON.stringify(merged));
        setRecords(merged);
      }
    } catch (error) {
      console.error("Gagal menarik LKH:", error);
      const stored = await AsyncStorage.getItem("@lkh_records");
      if (stored) setRecords(JSON.parse(stored));
    }
  };

  const saveLocalRecords = async (newRecords: { [key: string]: LKHRecord }) => {
    try {
      await AsyncStorage.setItem("@lkh_records", JSON.stringify(newRecords));
      setRecords(newRecords);
    } catch (e) {
      console.error("Gagal simpan data lokal", e);
    }
  };

  const isWithinKKNPeriod = (date: Date) => {
    // SAKLAR UJI - lihat ABAIKAN_PERIODE_KKN di dekat awal berkas.
    if (ABAIKAN_PERIODE_KKN) return true;
    // Fail-open kalau server belum punya tanggal periode sama sekali (lihat
    // kknPeriod di atas) - jangan blokir absen gara-gara data admin belum
    // lengkap.
    if (!kknPeriod.start || !kknPeriod.end) return true;
    return date >= kknPeriod.start && date <= kknPeriod.end;
  };

  const handleDatePress = async (day: number) => {
    const selectedDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      day,
    );

    const dateStr = toDateKey(selectedDate);
    const todayStr = toDateKey(new Date());

    if (!isWithinKKNPeriod(selectedDate)) {
      Alert.alert("Perhatian", "Tanggal ini bukan dalam periode aktif KKN.");
      return;
    }

    // Tanggal hanya menampilkan info. Pengambilan foto absensi dilakukan
    // lewat tombol "Ambil Foto Absensi" di bawah kalender, bukan dari sini.
    if (dateStr === todayStr) {
      Alert.alert(
        "Hari Ini",
        records[dateStr]?.status
          ? `Status: ${
              records[dateStr]?.status === "synced"
                ? "Sudah Tersinkron (Biru)"
                : "Belum Tersinkron (Kuning)"
            }`
          : 'Anda belum absen hari ini. Gunakan tombol "Ambil Foto Absensi" di bawah kalender.',
      );
    } else {
      Alert.alert(
        "Info Tanggal",
        `Tanggal: ${dateStr}\nStatus: ${
          records[dateStr]?.status === "synced"
            ? "Sudah Tersinkron (Biru)"
            : records[dateStr]?.status === "unsynced"
              ? "Belum Tersinkron (Kuning)"
              : "Tidak Mengisi / Kosong (Merah)"
        }`,
      );
    }
  };

  const handleOpenAttendanceCamera = async () => {
    const today = new Date();

    // Penjagaan kedua, bukan pengganti tombol yang terkunci. Keadaan tombol
    // dihitung saat render; kalau catatan hari ini baru tiba sesudah jari
    // menyentuh layar, tekanan itu sudah telanjur diteruskan. Pemeriksaan di
    // sini berjalan pada nilai terbaru, jadi menutup sisa celahnya.
    if (isCheckingRecords) return;
    if (alreadyAttendedToday) {
      Alert.alert("Sudah Absen", "Presensi hari ini sudah tercatat.");
      return;
    }

    if (!isWithinKKNPeriod(today)) {
      Alert.alert("Perhatian", "Hari ini bukan dalam periode aktif KKN.");
      return;
    }

    // Enrollment terpisah: tanpa set wajah terdaftar, pintu masuknya adalah
    // modal pendaftaran (3-5 foto), BUKAN kamera absen - dan semua pemeriksaan
    // berat di bawah (izin kamera, geofence) tidak perlu dijalankan dulu.
    // Menggantikan jalur lama yang diam-diam menjadikan foto absen pertama
    // sebagai wajah patokan.
    if (!(await isEnrolled())) {
      setIsEnrollmentVisible(true);
      return;
    }

    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert("Izin Ditolak", "Izin kamera dibutuhkan untuk selfie absensi.");
        return;
      }
    }
    if (!cameraDevice) {
      Alert.alert("Error", "Kamera depan tidak ditemukan di perangkat ini.");
      return;
    }

    setIsCheckingLocation(true);
    try {
      const acuanLokasi = await resolvePoskoLocation({
        kecamatan: userData.kecamatan,
        kabupaten: userData.kabupaten,
        poskoKoordinat: userData.poskoKoordinat,
        poskoRadius: userData.poskoRadius,
      });
      const { allowed, mocked, distanceKm, locationUnresolved, userLocation } =
        await checkAttendanceLocation(acuanLokasi);

      // Urutan dan pesannya sama dengan aplikasi Flutter resmi
      // (validasiLokasiMaps): lokasi palsu diperiksa lebih dulu, lalu jarak.
      // Keduanya menghentikan proses sebelum kamera dibuka, jadi tidak ada
      // presensi yang tersimpan.
      if (mocked) {
        Alert.alert(
          "Lokasi Palsu",
          "Anda terdeteksi menggunakan lokasi palsu (fake GPS)",
        );
        return;
      }
      pendingCoordinatesRef.current = `${userLocation.latitude},${userLocation.longitude}`;

      if (locationUnresolved) {
        // Tidak bisa menentukan lokasi posko sama sekali (data kecamatan
        // kosong & geocoding gagal) - absen tetap diizinkan (verifikasi
        // wajah tetap jadi pertahanan utama), tapi diberi tahu.
        console.log(
          "Geofence dilewati: lokasi posko tidak bisa ditentukan untuk akun ini.",
        );
      } else if (!allowed && distanceKm !== null && acuanLokasi) {
        // Pesan utama persis seperti di Flutter; jaraknya ditambahkan karena
        // tanpa angka itu mahasiswa tidak tahu seberapa jauh ia meleset.
        Alert.alert(
          "Di Luar Area KKN",
          `Anda tidak berada dalam area lokasi KKN anda\n\nJarak Anda ${formatJarak(distanceKm * 1000)} dari titik lokasi KKN, batasnya ${formatJarak(acuanLokasi.radiusMeter)}.`,
        );
        return;
      }
    } catch (error) {
      if (error instanceof LocationPermissionDeniedError) {
        Alert.alert("Izin Lokasi Ditolak", error.message);
      } else if (error instanceof LocationUnavailableError) {
        Alert.alert("Lokasi Tidak Ditemukan", error.message);
      } else {
        Alert.alert("Error", "Gagal memeriksa lokasi. Coba lagi.");
      }
      return;
    } finally {
      setIsCheckingLocation(false);
    }

    // Muat model lebih awal, jangan ditunggu. Pemeriksaan identitas di dalam
    // tantangan adalah pemakaian PERTAMA model pada sesi ini, dan memuat
    // berkas 5 MB beserta interpreternya memakan beberapa detik - tanpa ini
    // jeda tersebut jatuh di tengah tantangan dan terbaca sebagai aplikasi
    // menggantung. Pengguna masih harus menoleh dua kali sebelum pemeriksaan
    // berjalan, jadi waktunya cukup untuk selesai di latar.
    warmUpFaceModel();

    // Setiap sesi absen memulai tantangan keaktifan dari nol - membuktikan
    // wajah hidup yang hadir sekarang, bukan sekali seumur pemasangan.
    pengikatanAtRef.current = null;
    liveness.reset();
    // Output kamera baru untuk sesi kamera baru (iOS saja) - lihat
    // photoConfig. Dinaikkan bersama setIsCameraVisible supaya <Camera>
    // dipasang langsung dengan output barunya, tanpa konfigurasi ulang.
    if (Platform.OS === "ios") setSesiKamera((n) => n + 1);
    setIsCameraVisible(true);
  };

  const persistAttendance = async (photoUri: string) => {
    const todayStr = toDateKey(new Date());

    const dir = FileSystem.documentDirectory || "";
    const newUri = `${dir}lkh_${todayStr}.jpg`;
    await FileSystem.copyAsync({
      from: photoUri,
      to: newUri,
    });

    const updatedRecords = {
      ...records,
      [todayStr]: {
        date: todayStr,
        status: "unsynced" as LKHStatus,
        photoUri: newUri,
        kode: records[todayStr]?.kode || generateLocalRecordCode(),
        koordinat: pendingCoordinatesRef.current || records[todayStr]?.koordinat,
      },
    };

    await saveLocalRecords(updatedRecords);
  };

  const takeSelfie = async () => {
    // Identitas sudah diperiksa DI DALAM tantangan keaktifan (lihat
    // handleBindIdentity). Yang diperiksa di sini hanyalah umurnya: makin
    // lama jarak antara pemeriksaan itu dan shutter ditekan, makin lebar
    // jendela untuk menukar wajah di antaranya.
    // liveness.passed diperiksa ulang di sini, tidak hanya lewat
    // captureDisabled: penjaga kesinambungan dapat membatalkan kelulusan
    // kapan saja, dan jalur ini terlalu penting untuk bergantung pada satu
    // penjagaan di lapisan tampilan saja.
    const terikatPada = pengikatanAtRef.current;
    if (
      !liveness.passed ||
      terikatPada === null ||
      Date.now() - terikatPada > PENGIKATAN_TTL_MS
    ) {
      pengikatanAtRef.current = null;
      liveness.reset();
      Alert.alert(
        "Ulangi Deteksi Aktif",
        "Terlalu lama sejak wajah Anda diperiksa. Silakan ulangi tantangan gerak lalu ambil foto.",
      );
      return;
    }

    setIsProcessingFace(true);
    try {
      const photoFile = await photoOutput.capturePhotoToFile({}, {});
      // capturePhotoToFile() returns a plain filesystem path, not a
      // file:// URL - every downstream consumer here (expo-image-
      // manipulator, expo-file-system, <Image> source) expects a URI.
      const photoUri = `file://${photoFile.filePath}`;

      let embedding: Float32Array;
      try {
        embedding = await getFaceEmbedding(photoUri);
      } catch (error) {
        if (error instanceof NoFaceDetectedError) {
          setDebugPhotoUri(photoUri);
          Alert.alert("Wajah Tidak Terdeteksi", error.message);
        } else if (error instanceof MultipleFacesDetectedError) {
          Alert.alert("Wajah Lebih dari Satu", error.message);
        } else if (error instanceof PoorQualityFaceError) {
          Alert.alert("Foto Kurang Jelas", error.message);
        } else if (error instanceof Error) {
          Alert.alert("Verifikasi Wajah Gagal", error.message);
        } else {
          Alert.alert("Error", "Gagal memproses wajah. Coba lagi.");
        }
        return;
      }

      // Putusan agen verifikasi: median-of-N terhadap set terdaftar lalu
      // dibandingkan ambang - lihat utils/verificationAgent.ts (PEAS + tipe
      // agen) dan catatan median di similarityToEnrollment().
      const verdict = await decideAttendance(embedding);

      if (verdict.kind === "not-enrolled") {
        // Set wajah hilang di tengah jalan (misal di-reset dari halaman
        // Profil) - jalur enroll-diam-diam sudah dihapus, jadi arahkan ke
        // modal pendaftaran resmi alih-alih menjadikan foto ini patokan.
        setIsCameraVisible(false);
        setIsEnrollmentVisible(true);
        return;
      }

      await logSimilaritySample(verdict.similarity, "unknown");
      // Presisi 2 desimal sengaja dipakai sementara (bukan dibulatkan ke
      // bilangan bulat) supaya angka kemiripan yang asli kelihatan buat
      // kalibrasi - "100%" yang dibulatkan bisa saja aslinya 99.4%.
      const similarityLabel = (verdict.similarity * 100).toFixed(2);
      if (verdict.kind === "rejected") {
        Alert.alert(
          "Wajah Tidak Cocok",
          `Wajah pada foto tidak cocok dengan wajah patokan absensi Anda (kemiripan ${similarityLabel}%). Absensi tidak disimpan.`,
        );
        return;
      }

      await persistAttendance(photoUri);
      setIsCameraVisible(false);
      Alert.alert(
        "Berhasil",
        `Wajah terverifikasi (kemiripan ${similarityLabel}%). Laporan dan foto selfie berhasil disimpan offline.`,
      );
    } catch (error) {
      console.error("Gagal mengambil foto selfie", error);
      // ANDROID SAJA: pesan asli ikut ditampilkan, karena logcat tidak selalu
      // bisa diambil dari HP pengguna dan tanpa ini kegagalan kamera hanya
      // terlihat sebagai "Gagal mengambil foto selfie" tanpa petunjuk apa pun.
      // Di iOS teksnya sengaja dibiarkan persis seperti semula.
      const detail =
        Platform.OS === "android" && error instanceof Error
          ? `\n\n${error.name}: ${error.message}`
          : "";
      Alert.alert("Error", `Gagal mengambil foto selfie.${detail}`);
    } finally {
      setIsProcessingFace(false);
    }
  };

  const confirmSync = () => {
    Alert.alert("Sinkron", "Yakin Mensinkron data LKH yang masih kuning?", [
      { text: "Batal", style: "cancel" },
      {
        text: "OK",
        onPress: () => handleSync(),
      },
    ]);
  };

  // Endpoint & nama field mengikuti apa yang diterima API server LKH (tak ada
  // dokumentasi publik). Kalau server menolak dengan pesan validasi tertentu,
  // itu jadi patokan koreksi - makanya pesan error asli server ditampilkan ke
  // pengguna, bukan sekadar "gagal".
  const SIMPAN_LKH_URL = `${API_BASE}/api/simpan-lkh`;

  const syncOneRecord = async (
    penggunaId: string,
    authToken: string,
    record: LKHRecord,
  ): Promise<{ ok: boolean; message?: string }> => {
    if (!record.photoUri) return { ok: false, message: "Tidak ada foto tersimpan." };
    if (!penggunaId) {
      return {
        ok: false,
        message: "ID peserta tidak ditemukan. Silakan login ulang.",
      };
    }

    const formData = new FormData();
    // Payload yang diterima endpoint simpan-lkh: {pengguna_id, kode, koordinat,
    // waktu} + foto. TANPA program_id / deskripsi - server menerima presensi
    // tanpa keduanya, jadi app tak butuh /api/program. pengguna_id = id NUMERIK,
    // bukan nim.
    formData.append("pengguna_id", penggunaId);
    formData.append("kode", record.kode || generateLocalRecordCode());
    formData.append("koordinat", record.koordinat || "");
    formData.append("waktu", record.date);
    formData.append("device_info", getDeviceInfoStr());
    formData.append("version", APP_VERSION);
    // React Native's FormData accepts this {uri,name,type} file shape (not
    // a real Blob) - the fetch polyfill turns it into a multipart part.
    formData.append("foto", {
      uri: record.photoUri,
      name: `lkh_${record.date}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob);

    const response = await fetch(SIMPAN_LKH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "User-Agent": API_USER_AGENT,
        Accept: "application/json",
      },
      body: formData,
    });

    const text = await response.text();
    if (text.trim().startsWith("<")) {
      return { ok: false, message: "Sesi login kadaluarsa, silakan login ulang." };
    }

    try {
      const parsed = JSON.parse(text);
      const ok = response.ok && (parsed.statusCode === undefined || parsed.statusCode === 200);
      return { ok, message: parsed.desc };
    } catch {
      return { ok: response.ok, message: response.ok ? undefined : text.slice(0, 200) };
    }
  };

  // silent=true: sinkron OTOMATIS di latar (dipanggil dari efek saat ada
  // laporan offline belum terkirim) - tanpa modal loading & tanpa Alert.
  // silent=false: dipicu tombol manual "Sinkronkan Data" (confirmSync) - pakai
  // modal loading & tampilkan hasilnya lewat Alert.
  const handleSync = async (silent = false) => {
    if (!silent) setIsSyncing(true);
    try {
      const currentToken = await AsyncStorage.getItem("@user_token");
      const penggunaId = await AsyncStorage.getItem("@user_id");
      if (!currentToken || !penggunaId) {
        if (!silent) {
          Alert.alert(
            "Gagal",
            "Sesi login tidak lengkap (ID peserta tidak ada). Silakan login ulang.",
          );
        }
        return;
      }

      const updatedRecords = { ...records };
      let countSync = 0;
      let countFailed = 0;
      let lastError = "";

      for (const key of Object.keys(updatedRecords)) {
        const record = updatedRecords[key];
        if (record.status !== "unsynced") continue;

        try {
          const result = await syncOneRecord(penggunaId, currentToken, record);
          if (result.ok) {
            updatedRecords[key] = { ...record, status: "synced" };
            countSync++;
          } else {
            countFailed++;
            if (result.message) lastError = result.message;
          }
        } catch (err) {
          countFailed++;
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      await saveLocalRecords(updatedRecords);
      await fetchServerLKH();

      if (!silent) {
        if (countFailed === 0) {
          Alert.alert(
            "Sinkronisasi Selesai",
            `${countSync} laporan berhasil disinkronkan ke server.`,
          );
        } else {
          Alert.alert(
            "Sinkronisasi Sebagian Gagal",
            `${countSync} berhasil, ${countFailed} gagal.` +
              (lastError ? `\n\nPesan server: ${lastError}` : ""),
          );
        }
      }
    } catch (e) {
      console.error("Gagal sinkronisasi", e);
      if (!silent) {
        Alert.alert("Gagal", "Terjadi kesalahan saat sinkronisasi online.");
      }
    } finally {
      if (!silent) setIsSyncing(false);
    }
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const todayStr = toDateKey(new Date());

    // null kalau server belum kasih tanggal periode sama sekali (lihat
    // kknPeriod) - dalam kondisi itu, tanggal kosong tidak ditandai merah
    // sama sekali (kita tidak tahu apa tanggal itu "harusnya diisi" atau
    // bukan), daripada menebak pakai rentang yang salah.
    const kknStartStr = kknPeriod.start ? toDateKey(kknPeriod.start) : null;
    const kknEndStr = kknPeriod.end ? toDateKey(kknPeriod.end) : null;

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<View key={`empty-${i}`} style={styles.dayCell} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = toDateKey(new Date(year, month, day));

      const record = records[dateStr];
      let bgStyle = styles.statusNone;

      if (dateStr === todayStr) {
        bgStyle = styles.statusToday;
      } else if (record?.status === "synced") {
        bgStyle = styles.statusSynced;
      } else if (record?.status === "unsynced") {
        bgStyle = styles.statusUnsynced;
      } else if (
        kknStartStr &&
        kknEndStr &&
        dateStr >= kknStartStr &&
        dateStr <= kknEndStr &&
        dateStr < todayStr
      ) {
        bgStyle = styles.statusEmpty;
      }

      days.push(
        <TouchableOpacity
          key={`day-${day}`}
          style={styles.dayCell}
          onPress={() => handleDatePress(day)}
        >
          <View style={[styles.dayCircle, bgStyle]}>
            <Text style={styles.dayText}>{day}</Text>
          </View>
        </TouchableOpacity>,
      );
    }

    return days;
  };

  // Shutter absen terkunci sampai tantangan keaktifan lolos (selain saat
  // sedang memproses). Tanpa ini foto/layar statis bisa langsung dijepret.
  // liveness.isBinding ikut mengunci shutter: selama identitas sedang
  // diperiksa, kamera sedang dipakai mengambil foto pengikatan, jadi
  // menjepret bersamaan akan bertabrakan dengan permintaan itu.
  const captureDisabled =
    isProcessingFace || liveness.isBinding || !liveness.passed;

  // Sudah absen hari ini? Cukup ADA catatan absen untuk tanggal ini dengan
  // status apa pun (synced/unsynced) - TIDAK lagi bergantung pada foto lokal.
  // Ini kunci sinkron lintas-perangkat: kalau sudah absen di iPhone lalu login
  // di Android, foto selfie-nya memang tak ikut (server tak mengirim balik file
  // foto), TAPI catatan tanggalnya ADA di server -> tombol tetap terkunci
  // "Sudah Absen Hari Ini" di perangkat kedua. Dulu syaratnya photoUri lokal,
  // sehingga di perangkat kedua tombol malah masih bisa diklik (bug lintas-hp).
  // WAJIB syarat hasEnrollment: setelah RESET WAJAH, wajah terdaftar hilang
  // walau catatan absen hari ini masih ada. Tanpa syarat ini tombol tetap
  // terkunci sehingga pengguna tak bisa mendaftar ulang wajahnya.
  const todayRecord = records[toDateKey(new Date())];
  const alreadyAttendedToday =
    hasEnrollment &&
    (todayRecord?.status === "synced" || todayRecord?.status === "unsynced");

  // Isi layar kamera absen, dipakai dua kali: sebagai lapisan biasa di
  // Android dan sebagai isi <Modal> di iOS (lihat komentar di bawah).
  // View polos + inset eksplisit, bukan SafeAreaView - alasan lengkap ada di
  // komentar header FaceEnrollmentModal. Singkatnya: tombol close yang duduk
  // di dalam area status bar / Dynamic Island tidak menerima sentuhan.
  const cameraSurface = (
        <View style={styles.cameraContainer}>
          {cameraDevice && (
            Platform.OS === "android" ? (
              // ===== ANDROID =====
              <Camera
                // Tinggi digeser 1px sampai preview mulai, lalu dikembalikan -
                // memaksa satu layout pass agar permukaan preview tergambar.
                style={[styles.camera, { bottom: previewStarted ? 0 : 1 }]}
                device={cameraDevice}
                isActive={isCameraVisible}
                // Elemen array ini WAJIB stabil: VisionCamera membandingkan
                // outputs per-elemen, dan elemen yang berganti identitas
                // memicu configure() -> unbindAll(). Lihat faceDetectorOutput.
                outputs={cameraOutputs}
                // implementationMode SENGAJA tidak diisi -> PreviewView memakai
                // mode bawaannya. Sebelumnya di sini ada "compatible"
                // (TextureView) sebagai penangkal masalah <Modal>; modalnya
                // kini sudah dihapus, dan setter implementationMode di
                // HybridPreviewView memanggil connectPreviewOutput() TANPA
                // memutus koneksi lama, sehingga menyetelnya justru berisiko
                // menyambungkan output preview dua kali - preview tetap
                // melaporkan "mulai" tetapi tidak pernah menggambar.
                implementationMode={useTextureView ? "compatible" : undefined}
                onPreviewStarted={() => setPreviewStarted(true)}
                onError={faceQualityGate.onFaceDetectionError}
              />
            ) : (
              // ===== jalur iOS =====
              // Larangan menyentuh jalur ini DICABUT 9 Oktober 2026 atas
              // permintaan pengguna. Yang tetap berlaku: penanganan preview
              // hitam dan sesi kamera yang dikonfigurasi ulang adalah
              // perbaikan khusus ANDROID dan sengaja tidak dibawa ke sini -
              // gejalanya tidak pernah muncul di iPhone, jadi menerapkannya
              // hanya menambah risiko tanpa menyelesaikan apa pun.
              //
              // Setiap perubahan di blok ini hanya dapat dibuktikan lewat
              // build GitHub Actions; tidak ada Mac untuk mengujinya di sini.
              //
              // Sejak 29 Oktober 2026 memakai <Camera> polos dengan output
              // detektor wajah yang stabil, sama seperti Android - lihat
              // faceDetectorOutput. Opsi detektornya (fast, tanpa landmark dan
              // klasifikasi, minFaceSize) dipindah ke sana tanpa diubah.
              <Camera
                style={styles.camera}
                device={cameraDevice}
                isActive={isCameraVisible}
                outputs={cameraOutputs}
                constraints={cameraConstraints}
                exposure={biasPencahayaan}
                enableLowLightBoost
                onError={faceQualityGate.onFaceDetectionError}
              />
            )
          )}
          {/* DIAGNOSTIK ANDROID DILEPAS 7 Oktober 2026.
              Dulu di sini ada penanda nomor build beserta keadaan preview, dan
              tombol pengubah mode permukaan - keduanya dipasang saat memburu
              bug "preview hitam" di Android, dan komentarnya sendiri menyebut
              akan dilepas begitu preview beres. Preview sudah terbukti jalan
              pada pengujian perangkat, jadi keduanya dihapus agar layar
              presensi bersih.

              previewStarted TETAP dipakai: nilainya menggeser tinggi preview
              satu piksel untuk memaksa satu kali layout pass - lihat prop
              style pada <Camera> Android di atas. useTextureView juga tetap
              ada sebagai saklar di kode, hanya tombolnya yang dilepas. */}
          <View
            style={[
              styles.cameraControls,
              { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
            ]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => {
                // Bersihkan overlay foto debug juga - kalau tidak, foto lama
                // ini akan nongol lagi menutupi kamera di sesi absen berikutnya
                // (debugPhotoUri masih ke-set dari kegagalan sebelumnya).
                setDebugPhotoUri(null);
                setIsCameraVisible(false);
              }}
            >
              <BlurView intensity={50} tint="dark" style={styles.closeBtnBlur}>
                <Ionicons name="close" size={24} color="#FFF" />
              </BlurView>
            </TouchableOpacity>

            {/* Penutup saat identitas diperiksa.
                Jepretan pengikatan menghentikan aliran preview sesaat, dan
                jeda itu tampak sebagai kedipan hitam di tengah tantangan -
                terlihat seperti aplikasi tersendat padahal sedang bekerja.
                Lapisan ini menutupinya dengan keterangan yang jujur tentang
                apa yang sedang berlangsung.

                Sengaja hanya lapisan tampilan: tidak ada prop <Camera> yang
                disentuh, sehingga sesi kamera tidak dikonfigurasi ulang
                (penyebab preview hitam yang sebenarnya - lihat catatan di
                faceDetectorOutput). */}
            {liveness.isBinding && (
              <View style={styles.bindingOverlay} pointerEvents="none">
                <BlurView intensity={40} tint="dark" style={styles.bindingBox}>
                  <ActivityIndicator size="large" color="#FFF" />
                  <Text maxFontSizeMultiplier={1.3} style={styles.bindingText}>
                    Memeriksa identitas
                  </Text>
                </BlurView>
              </View>
            )}

            {/* Panah arah tolehan. Tidak tampil sama sekali pada platform
                yang tanda yaw-nya belum diukur - lihat SISI_YAW_POSITIF di
                hooks/useLivenessChallenge.ts. */}
            {liveness.arahPanah && (
              <View style={styles.panahLapisan} pointerEvents="none">
                {liveness.arahPanah !== "kanan" && (
                  <View style={styles.panahDeret}>
                    {[1, 0.6, 0.6].map((redup, i) => (
                      <Ionicons
                        key={i}
                        name="chevron-back"
                        size={40}
                        color={`rgba(255,255,255,${redup})`}
                        style={styles.panahTanda}
                      />
                    ))}
                  </View>
                )}
                <View style={{ flex: 1 }} />
                {liveness.arahPanah !== "kiri" && (
                  <View style={styles.panahDeret}>
                    {[0.6, 0.6, 1].map((redup, i) => (
                      <Ionicons
                        key={i}
                        name="chevron-forward"
                        size={40}
                        color={`rgba(255,255,255,${redup})`}
                        style={styles.panahTanda}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}

            {TAMPILKAN_YAW && yawUji !== null && (
              <Text style={styles.yawUji}>
                yaw uji: {yawUji > 0 ? "+" : ""}
                {yawUji}
              </Text>
            )}
            {TAMPILKAN_YAW && ikatUji !== null && (
              <Text style={[styles.yawUji, styles.ikatUji]}>{ikatUji}</Text>
            )}

            <View style={styles.cameraBottomArea}>
              {/* Kemajuan tantangan sebagai strip, bukan "(langkah 2/5)" yang
                  menempel di ujung kalimat - angka di dalam kalimat panjang
                  terlewat begitu saja sambil menoleh. Jumlah stripnya berbeda
                  tiap sesi karena rencananya diundi. */}
              {!liveness.passed && (
                <View style={styles.langkahBaris}>
                  {Array.from({ length: liveness.total }, (_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.langkahStrip,
                        i < liveness.step && styles.langkahStripAktif,
                      ]}
                    />
                  ))}
                </View>
              )}

              {/* Kartu instruksi: baris utama besar, keterangan kecil di
                  bawahnya, dan garis warna di kiri yang menandai nadanya.
                  Peringatan ditahan 2 detik di dalam hook - tanpa itu pesannya
                  ditimpa bingkai kamera berikutnya dan hanya tampak berkedip. */}
              <BlurView
                intensity={50}
                tint="dark"
                style={[
                  styles.kartuInstruksi,
                  liveness.nada === "peringatan" && styles.kartuPeringatan,
                  liveness.nada === "lolos" && styles.kartuLolos,
                ]}
              >
                <View
                  style={[
                    styles.kartuGaris,
                    liveness.nada === "peringatan" && styles.kartuGarisPeringatan,
                    liveness.nada === "lolos" && styles.kartuGarisLolos,
                  ]}
                />
                <View style={styles.kartuIsi}>
                  <View style={styles.kartuJudulBaris}>
                    {liveness.arahPanah && (
                      <Ionicons
                        name={
                          liveness.arahPanah === "kanan"
                            ? "arrow-forward"
                            : liveness.arahPanah === "kiri"
                              ? "arrow-back"
                              : "swap-horizontal"
                        }
                        size={28}
                        color="#FFFFFF"
                      />
                    )}
                    {/* Paling banyak dua baris: di ponsel sempit hurufnya
                        sedikit mengecil, bukan melipat jadi tiga baris. */}
                    <Text
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      maxFontSizeMultiplier={1.3}
                      style={[
                        styles.kartuJudul,
                        liveness.nada === "peringatan" && styles.kartuJudulPeringatan,
                        liveness.nada === "lolos" && styles.kartuJudulLolos,
                      ]}
                    >
                      {liveness.instruction}
                    </Text>
                  </View>
                  <Text maxFontSizeMultiplier={1.3} style={styles.kartuSub}>
                    {liveness.passed ? faceQualityGate.message : liveness.sub}
                  </Text>
                </View>
              </BlurView>

              <TouchableOpacity
                style={[
                  styles.captureBtn,
                  captureDisabled && styles.captureBtnDisabled,
                ]}
                onPress={takeSelfie}
                disabled={captureDisabled}
              >
                <View
                  style={[
                    styles.captureInner,
                    captureDisabled && styles.captureInnerDisabled,
                  ]}
                />
              </TouchableOpacity>
            </View>
          </View>

          {isProcessingFace && (
            <View style={styles.faceProcessingOverlay}>
              <ActivityIndicator size="large" color="#FFF" />
              <Text style={styles.faceProcessingText}>
                Memverifikasi wajah...
              </Text>
            </View>
          )}

          {/* DIAGNOSTIK SEMENTARA: lihat komentar di deklarasi debugPhotoUri.
              Dirender sebagai overlay di DALAM Modal kamera ini (bukan
              <Modal> terpisah) - dua <Modal> RN yang sama-sama visible di
              iOS tidak reliable (modal kedua bisa gagal tampil secara diam-
              diam), dan modal kamera ini sengaja tetap terbuka saat deteksi
              gagal supaya pengguna bisa langsung coba lagi. */}
          {!!debugPhotoUri && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "#000",
              }}
            >
              <Image
                source={{ uri: debugPhotoUri }}
                style={{ flex: 1 }}
                resizeMode="contain"
              />
              <TouchableOpacity
                style={{ padding: 16, alignItems: "center" }}
                onPress={() => setDebugPhotoUri(null)}
              >
                <Text style={{ color: "#FFF", fontSize: 16 }}>Tutup</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* SafeAreaView dari react-native hanya bekerja di iOS; di Android ia
          View biasa tanpa inset, sehingga kartu teratas mepet ke jam dan
          indikator jaringan. Inset ditambahkan ke KONTEN yang digulir saja,
          bukan ke container, supaya lapisan penuh layar (mis. kamera) tetap
          menutupi layar sampai ke tepi atas. */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          Platform.OS === "android" && {
            paddingTop: insets.top + 16,
            // Tab bar mengambang ikut naik setinggi inset bawah (lihat
            // tabBarBottom di app/(tabs)/index.tsx), jadi ruang bawah konten
            // harus naik sebanyak itu juga - kalau tidak, legenda dan tombol
            // sinkron justru tertutup tab bar yang baru.
            paddingBottom: 110 + insets.bottom,
          },
        ]}
      >
        <View style={styles.glassShadow}>
          <View style={styles.profileCard}>
            {userData.fotoUrl && failedPhotoUri !== userData.fotoUrl ? (
              <Image
                source={{
                  uri: userData.fotoUrl,
                  // Header (Bearer + User-Agent yang diharapkan server) hanya
                  // untuk URL remote http(s): endpoint foto butuh token & UA
                  // itu. Dikirim bersyarat agar tetap aman untuk uri non-http.
                  ...(userData.fotoUrl.startsWith("http")
                    ? { headers: profilePhotoHeaders(token) }
                    : {}),
                }}
                style={styles.profileImage}
                // Catat URI-nya, bukan sekadar "gagal": galat milik URI lama
                // tidak boleh mematikan URI baru (lihat failedPhotoUri).
                onError={() => setFailedPhotoUri(userData.fotoUrl)}
              />
            ) : (
              <View style={[styles.profileImage, styles.profileAvatarFallback]}>
                <Text style={styles.profileAvatarText}>
                  {initials(userData.nama)}
                </Text>
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{userData.nama}</Text>
              <Text style={styles.profileNim}>{userData.nim}</Text>
              <Text style={styles.profileMajor}>{userData.prodi}</Text>
            </View>
          </View>
        </View>

        <View style={styles.glassShadow}>
          <View style={styles.calendarCard}>
            <View style={styles.monthNav}>
              <TouchableOpacity
                style={styles.monthNavBtn}
                onPress={() =>
                  setCurrentDate(
                    new Date(currentDate.setMonth(currentDate.getMonth() - 1)),
                  )
                }
              >
                <Ionicons name="chevron-back" size={20} color="#1C1C1E" />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {currentDate.toLocaleString("id-ID", {
                  month: "long",
                  year: "numeric",
                })}
              </Text>
              <TouchableOpacity
                style={styles.monthNavBtn}
                onPress={() =>
                  setCurrentDate(
                    new Date(currentDate.setMonth(currentDate.getMonth() + 1)),
                  )
                }
              >
                <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
              </TouchableOpacity>
            </View>

            <View style={styles.weekDaysRow}>
              {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].map((d) => (
                <Text key={d} style={styles.weekDayText}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>{renderCalendar()}</View>

            {/* Tombol ini sengaja diletakkan di sini, di antara kalender -
                bukan menempel pada sel tanggal manapun - sebagai satu-satunya
                pintu masuk untuk mengambil foto absensi. */}
            <TouchableOpacity
              style={[
                styles.attendanceButton,
                (isCheckingLocation ||
                  isCheckingEnrollment ||
                  isCheckingRecords ||
                  alreadyAttendedToday) &&
                  styles.attendanceButtonDisabled,
              ]}
              onPress={handleOpenAttendanceCamera}
              activeOpacity={0.85}
              disabled={
                isCheckingLocation ||
                isCheckingEnrollment ||
                isCheckingRecords ||
                alreadyAttendedToday
              }
            >
              {isCheckingLocation || isCheckingEnrollment || isCheckingRecords ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <FontAwesome5
                  name={alreadyAttendedToday ? "check-circle" : "camera"}
                  size={16}
                  color="#FFF"
                />
              )}
              <Text style={styles.attendanceButtonText}>
                {isCheckingLocation
                  ? "Memeriksa lokasi..."
                  : isCheckingEnrollment
                    ? "Memeriksa data wajah..."
                    : isCheckingRecords
                      ? "Memeriksa catatan hari ini..."
                    : alreadyAttendedToday
                      ? "Sudah Absen Hari Ini"
                      : hasEnrollment
                        ? "Ambil Foto Absensi"
                        : "Daftarkan Wajah (Langkah Pertama)"}
              </Text>
            </TouchableOpacity>
            <Text style={styles.attendanceHint}>
              {isCheckingEnrollment
                ? "Menyelaraskan data wajah dari server..."
                : hasEnrollment
                  ? "Wajah diverifikasi otomatis, dan absen hanya bisa di area lokasi KKN tanpa lokasi palsu."
                  : "Sebelum absen, daftarkan wajah Anda lewat 3-5 foto selfie. Absen hanya bisa di area lokasi KKN tanpa lokasi palsu."}
            </Text>

            <View style={styles.legendContainer}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.statusSynced]} />
                <Text style={styles.legendText}>Sudah Tersinkron</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.statusUnsynced]} />
                <Text style={styles.legendText}>Belum Tersinkron</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.statusEmpty]} />
                <Text style={styles.legendText}>Tidak Mengisi</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.statusToday]} />
                <Text style={styles.legendText}>Hari ini</Text>
              </View>
            </View>

            {!isWithinKKNPeriod(new Date()) && (
              <Text style={styles.warningText}>Bukan periode LKH</Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Tombol sinkron MELAYANG (FAB) di pojok kanan bawah - ikon saja, seperti
          build 30. Sengaja SIBLING dari ScrollView (bukan di dalamnya) supaya
          menempel di layar & tidak ikut ter-scroll. */}
      {/* Disembunyikan selama kamera terbuka: elevation-nya bisa menggambar di
          atas lapisan kamera sekarang setelah lapisan itu tidak lagi memakai
          elevation. */}
      {!isCameraVisible && (
      <TouchableOpacity
        style={styles.fabButton}
        onPress={confirmSync}
        activeOpacity={0.8}
        disabled={isSyncing}
      >
        <FontAwesome5 name="sync-alt" size={18} color="#FFF" />
      </TouchableOpacity>
      )}

      <Modal transparent visible={isSyncing} animationType="fade">
        <View style={styles.modalLoadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#0E783D" />
            <Text style={styles.loadingText}>Mensinkronkan Data...</Text>
          </View>
        </View>
      </Modal>

      {/* ANDROID: kamera SENGAJA tidak dibungkus <Modal>.
          Di Android sebuah <Modal> RN adalah Dialog dengan jendela SENDIRI.
          PreviewView CameraX di dalam jendela terpisah itu tidak pernah
          terkomposisi ke layar: aliran frame tetap jalan (deteksi wajah dan
          tantangan keaktifan normal), tetapi yang tampak hanya HITAM - dan
          gambarnya baru muncul begitu ada dialog lain yang memaksa jendela
          menggambar ulang. Karena itu di Android kamera dirender sebagai
          lapisan biasa di dalam pohon tampilan yang sama.
          iOS TETAP memakai <Modal> seperti semula. */}
      {Platform.OS === "android" ? (
        isCameraVisible ? (
          <View style={styles.cameraOverlay}>{cameraSurface}</View>
        ) : null
      ) : (
        <Modal visible={isCameraVisible} animationType="slide">
          {cameraSurface}
        </Modal>
      )}

      {/* Modal pendaftaran wajah (enrollment terpisah). Sengaja sebagai
          sibling dari modal kamera absen di atas - keduanya tidak akan pernah
          visible bersamaan: gate di handleOpenAttendanceCamera menjamin kamera
          absen hanya terbuka setelah enrollment selesai, dan dua <Modal> RN
          yang sama-sama visible di iOS tidak reliable (lihat catatan serupa
          di debug overlay modal kamera). */}
      <FaceEnrollmentModal
        visible={isEnrollmentVisible}
        onClose={() => setIsEnrollmentVisible(false)}
        onComplete={() => {
          setIsEnrollmentVisible(false);
          setHasEnrollment(true);
        }}
      />
    </SafeAreaView>
  );
}

const ACCENT = "#0E783D";
const TEXT_PRIMARY = "#1C1C1E";
const TEXT_SECONDARY = "#6E6E73";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EEF1F6",
  },
  scrollContent: {
    padding: 16,
    // Ruang bawah = tinggi tab bar mengambang (bottom:14 + 62) + jarak aman,
    // supaya tombol sinkron & legenda tidak tertutup tab bar.
    paddingBottom: 110,
  },
  glassShadow: {
    borderRadius: 28,
    marginBottom: 16,
    shadowColor: "#3A4B5C",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  profileCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    padding: 18,
    borderRadius: 28,
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ECEFF3",
  },
  profileImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 16,
    backgroundColor: "#EEE",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
  },
  // Avatar inisial saat tidak ada foto profil - warna aksen + inisial putih,
  // seragam dengan avatar sisi dosen (PembimbingScreen).
  profileAvatarFallback: {
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "700",
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  profileNim: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginVertical: 2,
  },
  profileMajor: {
    fontSize: 13,
    color: ACCENT,
    fontWeight: "600",
  },
  calendarCard: {
    backgroundColor: "#FFFFFF",
    padding: 18,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ECEFF3",
  },
  monthNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  monthNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(120,130,150,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  weekDaysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  weekDayText: {
    width: "14%",
    textAlign: "center",
    fontWeight: "600",
    color: TEXT_SECONDARY,
    fontSize: 12,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14%",
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 4,
  },
  // Lingkaran warna status di-inset dari sel supaya selalu terlihat sebagai
  // lingkaran terpisah, tidak menyatu jadi kotak/pil dengan tanggal sebelahnya.
  dayCircle: {
    width: DAY_CIRCLE_SIZE,
    height: DAY_CIRCLE_SIZE,
    borderRadius: DAY_CIRCLE_SIZE / 2,
    // overflow:hidden memaksa Fabric meng-clip ke borderRadius. Tanpa ini,
    // di Android New Architecture sebagian sel (yang tidak "hari ini")
    // dirender sebagai kotak-membulat walau borderRadius-nya lingkaran penuh.
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  dayText: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    fontWeight: "500",
  },
  statusSynced: { backgroundColor: "#AFC9F2" },
  statusUnsynced: { backgroundColor: "#F5DC94" },
  statusEmpty: { backgroundColor: "#F6C6C6" },
  statusToday: { backgroundColor: "#A6E3B8" },
  statusNone: { backgroundColor: "transparent" },

  attendanceButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: ACCENT,
    borderRadius: 18,
    paddingVertical: 14,
    marginTop: 18,
    shadowColor: ACCENT,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  attendanceButtonDisabled: {
    opacity: 0.6,
  },
  attendanceButtonText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 8,
    letterSpacing: 0.2,
  },
  attendanceHint: {
    textAlign: "center",
    fontSize: 14,
    color: TEXT_SECONDARY,
    marginTop: 8,
  },
  legendContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(120,130,150,0.18)",
    paddingTop: 14,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    width: "50%",
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  warningText: {
    color: "#D32F2F",
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
    fontSize: 13,
  },
  // Tombol sinkron MELAYANG (FAB) di pojok kanan bawah - ikon saja, seperti
  // build 30. Diposisikan absolute sebagai sibling ScrollView supaya tetap
  // menempel di layar (tidak ikut ter-scroll).
  fabButton: {
    position: "absolute",
    right: 20,
    // Tab bar melayang (app/(tabs)/index.tsx) menempati ~14-76px dari bawah
    // layar (bottom:14 + tinggi 62) - FAB digeser ke atas secukupnya supaya
    // lolos, tapi tetap di pojok kanan bawah.
    bottom: 90,
    backgroundColor: ACCENT,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 5,
  },
  modalLoadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingBox: {
    paddingVertical: 28,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  faceProcessingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  faceProcessingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
    color: "#FFF",
  },
  // Lapisan kamera Android: menutup seluruh layar di dalam pohon tampilan.
  // elevation/zIndex harus di atas FAB sinkron (elevation 5).
  diagToggle: {
    position: "absolute",
    left: 12,
    zIndex: 31,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  diagToggleText: { color: "#FFF", fontSize: 11 },
  diagBadge: {
    position: "absolute",
    left: 12,
    zIndex: 30,
    elevation: 30,
    color: "#FFF",
    fontSize: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    // SENGAJA tanpa elevation. PreviewView memakai SurfaceView, yang dirender
    // di lapisan TERPISAH di belakang jendela dan mengandalkan "hole punching"
    // agar terlihat. elevation memaksa subtree ini menjadi render layer
    // tersendiri, dan lubang itu tidak pernah tembus -> preview HITAM padahal
    // CameraX melaporkan frame sudah mengalir. zIndex saja sudah cukup karena
    // tombol sinkron disembunyikan selama kamera terbuka.
    zIndex: 20,
  },
  cameraContainer: {
    flex: 1,
    // Android: TRANSPARAN. Latar hitam opak di sini ikut menutup area lubang
    // SurfaceView sehingga yang terlihat hanya hitam. iOS tetap hitam seperti
    // semula (di sana preview dirender langsung ke dalam view).
    backgroundColor: Platform.OS === "android" ? "transparent" : "#000",
    position: "relative",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraControls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  closeBtn: {
    alignSelf: "flex-end",
    marginTop: 10,
    borderRadius: 20,
    overflow: "hidden",
  },
  closeBtnBlur: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  cameraBottomArea: {
    alignItems: "center",
  },
  // Ukuran instruksi diperbesar 4 November 2026 atas masukan dosen
  // pembimbing: instruksi dibaca dari sudut mata sambil menoleh, dengan
  // ponsel sejauh lengan - lihat docs/rencana-ukuran-instruksi-absen.md.
  langkahBaris: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  langkahStrip: {
    width: 28,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  langkahStripAktif: {
    backgroundColor: "#FFFFFF",
  },
  kartuInstruksi: {
    flexDirection: "row",
    alignSelf: "stretch",
    paddingVertical: 18,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  kartuPeringatan: {
    borderColor: "rgba(255,178,36,0.34)",
    backgroundColor: "rgba(38,27,10,0.55)",
  },
  kartuLolos: {
    borderColor: "rgba(94,234,212,0.34)",
    backgroundColor: "rgba(8,34,33,0.55)",
  },
  kartuGaris: {
    width: 4,
    borderRadius: 2,
    marginRight: 13,
    backgroundColor: "#FFFFFF",
  },
  kartuGarisPeringatan: { backgroundColor: "#FFB224" },
  kartuGarisLolos: { backgroundColor: "#5EEAD4" },
  kartuIsi: {
    flex: 1,
    gap: 6,
  },
  kartuJudulBaris: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  kartuJudul: {
    flexShrink: 1,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  kartuJudulPeringatan: { color: "#FFB224" },
  kartuJudulLolos: { color: "#5EEAD4" },
  kartuSub: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },
  // Panah arah tolehan di kedua sisi wajah, setinggi tengah layar. Tiga
  // tanda yang makin terang ke arah yang dituju, mengikuti sketsa mahasiswa.
  // Kapsul gelap dan bayangan di belakangnya: putih tembus pandang saja
  // hilang di latar langit siang (diuji 4 November 2026).
  panahLapisan: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  panahDeret: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  panahTanda: {
    marginHorizontal: -9,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Hasil pemeriksaan wajah menoleh - lihat handleTurnBind.
  ikatUji: {
    top: 170,
    right: 90,
    fontSize: 15,
  },
  // Angka yaw untuk mengukur SISI_YAW_POSITIF - lihat TAMPILKAN_YAW.
  yawUji: {
    position: "absolute",
    left: 16,
    top: 120,
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  // Menutupi kedipan hitam saat foto pengikatan diambil - lihat pemakaiannya
  // di dalam cameraSurface.
  bindingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  bindingBox: {
    alignItems: "center",
    paddingVertical: 22,
    paddingHorizontal: 28,
    borderRadius: 18,
    overflow: "hidden",
  },
  bindingText: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  captureBtn: {
    alignSelf: "center",
    marginBottom: 30,
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
  },
  captureBtnDisabled: {
    borderColor: "rgba(255,255,255,0.35)",
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFF",
  },
  captureInnerDisabled: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
