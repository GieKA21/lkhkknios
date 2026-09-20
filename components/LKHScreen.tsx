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
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput } from "react-native-vision-camera";
import { Camera as FaceDetectorCamera } from "react-native-vision-camera-face-detector";
import type { Face } from "react-native-vision-camera-face-detector";
import {
    FACE_DETECTOR_OPTIONS,
    getFaceEmbedding,
    logSimilaritySample,
    MultipleFacesDetectedError,
    NoFaceDetectedError,
    PoorQualityFaceError,
} from "../utils/faceAuthNative";
import {
    isEnrolled,
    syncEnrollmentFromServer,
} from "../utils/faceEnrollment";
import { decideAttendance } from "../utils/verificationAgent";
import FaceEnrollmentModal from "./FaceEnrollmentModal";
import { useFaceQualityGate } from "../hooks/useFaceQualityGate";
import { useLivenessChallenge } from "../hooks/useLivenessChallenge";
import { scheduleDailyAttendanceReminders } from "../utils/notifications";
import {
    checkAttendanceLocation,
    LocationPermissionDeniedError,
    LocationUnavailableError,
    MAX_DISTANCE_KM,
    resolvePoskoLocation,
} from "../utils/geofence";
import { APP_VERSION, API_USER_AGENT, getDeviceInfoStr } from "../utils/deviceInfo";
import {
    API_BASE,
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
    angkatanTanggalMulai: null,
    angkatanTanggalSelesai: null,
    settingTanggalMulai: null,
    settingTanggalSelesai: null,
  });

  const [token, setToken] = useState<string>("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [records, setRecords] = useState<{ [key: string]: LKHRecord }>({});

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
  const photoConfig = useMemo(
    () => ({ targetResolution: CommonResolutions.FHD_16_9 }),
    [],
  );
  const photoOutput = usePhotoOutput(photoConfig);
  const cameraOutputs = useMemo(() => [photoOutput], [photoOutput]);
  // PREVIEW GELAP: saat detektor wajah aktif, iOS membatasi exposure ke 1
  // durasi frame (1/30 dtk @30fps), jadi preview lebih gelap. 15fps
  // menggandakan batas exposure (2x lebih terang) & memangkas separuh callback
  // onFacesDetected ke thread JS - tantangan gerak kepala tak butuh 30fps.
  const cameraConstraints = useMemo(() => [{ fps: 15 }], []);
  const faceQualityGate = useFaceQualityGate();
  // Deteksi keaktifan: shutter absen terkunci sampai pengguna menyelesaikan
  // tantangan gerak (menoleh dua sisi), sehingga foto/layar statis tidak bisa
  // lolos - lihat hooks/useLivenessChallenge.ts.
  const liveness = useLivenessChallenge();
  // Satu callback menyuapi frame ke quality gate DAN liveness (keduanya baca
  // yaw/bounds yang sama). onFacesDetected dipanggil per-frame di thread JS &
  // tiap hook memanggil setState; tanpa throttle, komponen ini dirender ulang
  // puluhan kali/detik - UI tersendat & memperbesar peluang SIGSEGV (MLKit-iOS
  // di iOS 26). Dibatasi ~9x/detik: masih jauh lebih cepat dari gerak kepala
  // (~1 dtk/tolehan), yaw tetap tertangkap mulus.
  const lastFaceTickRef = useRef(0);
  const handleCameraFaces = useCallback(
    (faces: Face[]) => {
      const now = Date.now();
      if (now - lastFaceTickRef.current < FACE_TICK_MS) return;
      lastFaceTickRef.current = now;
      faceQualityGate.onFacesDetected(faces);
      liveness.onFacesDetected(faces);
    },
    // Kedua callback sudah di-useCallback([]) di dalam hook-nya (stabil);
    // merujuk membernya di sini aman, linter cuma tak bisa memverifikasinya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceQualityGate.onFacesDetected, liveness.onFacesDetected],
  );
  const insets = useSafeAreaInsets();
  const [isCameraVisible, setIsCameraVisible] = useState(false);
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
  // True kalau foto profil gagal dimuat (URL 404 / jaringan) - render jatuh
  // ke avatar inisial alih-alih lingkaran kosong.
  const [photoFailed, setPhotoFailed] = useState(false);
  // Guard agar sinkron-otomatis (pengganti tombol manual) hanya dicoba sekali
  // per sesi layar, bukan tiap render / saat sebagian gagal.
  const autoSyncTriedRef = useRef(false);

  // Sengaja cuma jalan sekali saat mount (bukan menambahkan loadUserProfile
  // dkk ke dependency array) - fungsi-fungsi itu tidak dibungkus useCallback
  // dan referensinya berubah tiap render, jadi menurutinya malah membuat
  // efek ini jalan berulang.
  useEffect(() => {
    loadUserProfile().then(() => {
      // Bersihkan dulu catatan bekas Mode Demo (fitur demo kini dihapus total)
      // SEBELUM menarik dari server, supaya tanggal yang cuma "demo" tidak lagi
      // tampil ungu dan mengikuti status server apa adanya (mis. merah).
      purgeDemoRecords().finally(() => fetchServerLKH());
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
  // data laporan berubah - otomatis dibatalkan begitu hari ini sudah absen.
  useEffect(() => {
    scheduleDailyAttendanceReminders(!!records[toDateKey(new Date())]).catch(
      () => {},
    );
  }, [records]);

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
        setPhotoFailed(false);

        setUserData({
          nama: data.nama,
          nim: data.nim,
          prodi: data.prodi,
          fotoUrl: dbFotoUrl,
          kecamatan: data.kecamatan || null,
          kabupaten: data.kabupaten || null,
          poskoKoordinat: data.poskoKoordinat || null,
          angkatanTanggalMulai: data.angkatanTanggalMulai || null,
          angkatanTanggalSelesai: data.angkatanTanggalSelesai || null,
          settingTanggalMulai: data.settingTanggalMulai || null,
          settingTanggalSelesai: data.settingTanggalSelesai || null,
        });

        // SENGAJA tidak lagi men-download foto ke file lokal lalu menukar URL-
        // nya: hasil unduhan (file://) sering gagal dibaca Image di Android,
        // sehingga foto yang tadinya tampil dari URL remote malah HILANG jadi
        // inisial beberapa detik kemudian. URL remote (http + header token)
        // sudah termuat & di-cache Image dengan andal - biarkan apa adanya.
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
      const poskoLocation = await resolvePoskoLocation({
        kecamatan: userData.kecamatan,
        kabupaten: userData.kabupaten,
        poskoKoordinat: userData.poskoKoordinat,
      });
      const { allowed, distanceKm, locationUnresolved, userLocation } =
        await checkAttendanceLocation(poskoLocation);
      pendingCoordinatesRef.current = `${userLocation.latitude},${userLocation.longitude}`;

      if (locationUnresolved) {
        // Tidak bisa menentukan lokasi posko sama sekali (data kecamatan
        // kosong & geocoding gagal) - absen tetap diizinkan (verifikasi
        // wajah tetap jadi pertahanan utama), tapi diberi tahu.
        console.log(
          "Geofence dilewati: lokasi posko tidak bisa ditentukan untuk akun ini.",
        );
      } else if (!allowed && distanceKm !== null) {
        Alert.alert(
          "Di Luar Jangkauan Posko",
          `Anda berjarak ${distanceKm.toFixed(1)} km dari posko. Absensi hanya bisa dilakukan dalam radius ${MAX_DISTANCE_KM} km dari posko/kecamatan lokasi KKN.`,
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

    // Setiap sesi absen memulai tantangan keaktifan dari nol - membuktikan
    // wajah hidup yang hadir sekarang, bukan sekali seumur pemasangan.
    liveness.reset();
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
      Alert.alert("Error", "Gagal mengambil foto selfie.");
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
  const captureDisabled = isProcessingFace || !liveness.passed;

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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.glassShadow}>
          <View style={styles.profileCard}>
            {userData.fotoUrl && !photoFailed ? (
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
                onError={() => setPhotoFailed(true)}
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
                  alreadyAttendedToday) &&
                  styles.attendanceButtonDisabled,
              ]}
              onPress={handleOpenAttendanceCamera}
              activeOpacity={0.85}
              disabled={
                isCheckingLocation || isCheckingEnrollment || alreadyAttendedToday
              }
            >
              {isCheckingLocation || isCheckingEnrollment ? (
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
                  ? `Wajah diverifikasi otomatis, dan absen hanya bisa dalam radius ${MAX_DISTANCE_KM} km dari posko.`
                  : `Sebelum absen, daftarkan wajah Anda lewat 3-5 foto selfie. Absen hanya bisa dalam radius ${MAX_DISTANCE_KM} km dari posko.`}
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
      <TouchableOpacity
        style={styles.fabButton}
        onPress={confirmSync}
        activeOpacity={0.8}
        disabled={isSyncing}
      >
        <FontAwesome5 name="sync-alt" size={18} color="#FFF" />
      </TouchableOpacity>

      <Modal transparent visible={isSyncing} animationType="fade">
        <View style={styles.modalLoadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#0E783D" />
            <Text style={styles.loadingText}>Mensinkronkan Data...</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={isCameraVisible} animationType="slide">
        {/* View polos + inset eksplisit, bukan SafeAreaView - alasan lengkap
            ada di komentar header FaceEnrollmentModal. Singkatnya: tombol
            close yang duduk di dalam area status bar / Dynamic Island tidak
            menerima sentuhan. */}
        <View style={styles.cameraContainer}>
          {cameraDevice && (
            <FaceDetectorCamera
              style={styles.camera}
              device={cameraDevice}
              isActive={isCameraVisible}
              outputs={cameraOutputs}
              constraints={cameraConstraints}
              // Low-light boost bawaan iOS (AVCaptureDevice): menaikkan
              // sensitivitas otomatis saat gelap, dan tidak berefek saat
              // cahaya sudah cukup - aman dipasang permanen.
              enableLowLightBoost
              onFacesDetected={handleCameraFaces}
              onError={faceQualityGate.onFaceDetectionError}
              performanceMode="fast"
              // DIAGNOSTIK: dipaksa false (bukan pakai
              // FACE_DETECTOR_OPTIONS.runLandmarks/runClassifications) untuk
              // isolasi apakah crash SIGSEGV saat kamera dibuka (lihat crash
              // log: EXC_BAD_ACCESS di thread JS Hermes, dipicu callback
              // onFacesDetected) berasal dari beban MLKit landmarks/
              // classifications di live preview - library ini sendiri
              // mengaku MLKit-iOS belum sepenuhnya kompatibel dengan iOS 26.
              // TIDAK memengaruhi pipeline foto still (utils/faceAuthNative.ts,
              // dipakai saat enroll/verify sungguhan) yang tetap pakai
              // FACE_DETECTOR_OPTIONS asli (landmarks+classifications ON).
              // Kalau setelah ini kamera masih crash, kemungkinan besar
              // masalahnya bukan di sini - live face detector-nya sendiri
              // yang perlu dimatikan total (bukan cuma landmarks/
              // classifications-nya).
              runLandmarks={false}
              runClassifications={false}
              minFaceSize={FACE_DETECTOR_OPTIONS.minFaceSize}
            />
          )}
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

            <View style={styles.cameraBottomArea}>
              <BlurView intensity={50} tint="dark" style={styles.liveStatusPill}>
                <Text style={styles.liveStatusText}>
                  {liveness.passed
                    ? `${faceQualityGate.message} (akan diverifikasi setelah jepret)`
                    : `${liveness.instruction} (langkah ${liveness.step}/${liveness.total})`}
                </Text>
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
      </Modal>

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
    fontSize: 12,
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
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000",
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
  liveStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 18,
  },
  liveStatusText: {
    fontSize: 13,
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
