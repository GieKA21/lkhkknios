import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
    Alert,
    Image,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    getResetQuota,
    MAX_FACE_RESETS,
    resetEnrollment,
    type ResetQuota,
} from "../utils/faceEnrollment";
import {
    clearCachedProfilePhoto,
    getCachedProfilePhoto,
    profilePhotoHeaders,
    profilePhotoUrl,
} from "../utils/api";
import Constants from "expo-constants";

interface ProfileScreenProps {
  onLogout: () => void;
}

interface ProfileData {
  nim: string;
  nama: string;
  tglLahir: string;
  prodi: string;
  fakultas: string;
  tahunMasuk: string;
  angkatan: string;
  kecamatan: string;
  kabupaten: string;
  serverFotoUrl: string;
}

/** Inisial 1-2 huruf dari nama, untuk avatar placeholder saat tak ada foto. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfileScreen({ onLogout }: ProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const [profileData, setProfileData] = useState<ProfileData>({
    nim: "",
    nama: "Memuat...",
    tglLahir: "",
    prodi: "",
    fakultas: "",
    tahunMasuk: "",
    angkatan: "",
    kecamatan: "",
    kabupaten: "",
    serverFotoUrl:
      "https://uin-alauddin.ac.id/assets/img/logo-uin-alauddin.png",
  });

  const [token, setToken] = useState<string>("");
  // Jatah reset otoritasnya di server (app Android memakai /api/jumlah-reset
  // & /api/max-reset) - nilai awal di bawah cuma penampil sementara sebelum
  // jawaban server masuk, dan jadi cadangan kalau server tak terjangkau.
  const [resetQuota, setResetQuota] = useState<ResetQuota>({
    remaining: MAX_FACE_RESETS,
    max: MAX_FACE_RESETS,
    fromServer: false,
  });
  // URI foto profil yang TERBUKTI gagal dimuat -> avatar inisial, bukan
  // lingkaran kosong. Menyimpan URI-nya, bukan boolean: layar ini di-mount
  // ulang tiap pindah tab dan uri-nya berganti dari remote ke berkas lokal di
  // tengah jalan, jadi onError milik uri lama tidak boleh mematikan uri baru.
  // Catatan lengkapnya ada di LKHScreen.tsx (failedPhotoUri).
  const [failedPhotoUri, setFailedPhotoUri] = useState<string | null>(null);

  // Sengaja cuma jalan sekali saat mount - lihat catatan yang sama di
  // LKHScreen.tsx.
  useEffect(() => {
    loadReferenceFaceState();
    loadUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReferenceFaceState = async () => {
    setResetQuota(await getResetQuota());
  };

  const loadUserData = async () => {
    try {
      const profileJson = await AsyncStorage.getItem("@user_profile");
      const savedToken = await AsyncStorage.getItem("@user_token");

      if (savedToken) setToken(savedToken);

      if (profileJson) {
        const data = JSON.parse(profileJson);
        // foto:null (peserta tanpa foto profil) -> jangan paksa nama file bogus
        // yang berujung 404; kosongkan supaya render pakai avatar inisial.
        const dbFotoUrl = data.foto ? profilePhotoUrl(data.foto) : "";
        setFailedPhotoUri(null);

        // iOS: kosongkan dulu, jangan pasang URL remote (lihat catatan sama di
        // LKHScreen). Berkas lokal dipasang di bawah, remote hanya cadangan.
        const fotoAwal = Platform.OS === "ios" ? "" : dbFotoUrl;

        setProfileData({
          nim: data.nim,
          nama: data.nama,
          tglLahir: data.tglLahir,
          prodi: data.prodi,
          fakultas: data.fakultas,
          tahunMasuk: data.tahunMasuk,
          angkatan: data.angkatan,
          kecamatan: data.kecamatan,
          kabupaten: data.kabupaten,
          serverFotoUrl: fotoAwal,
        });

        // iOS SAJA (lihat catatan sama di LKHScreen): unduh foto SEKALI ke
        // berkas lokal lalu tampilkan dari lokal, karena di iOS <Image> menarik
        // ulang foto tiap mount & sering gagal -> berkedip jadi inisial. Android
        // pakai URL remote (sudah andal). Kalau gagal, URL remote jadi fallback.
        if (Platform.OS === "ios" && dbFotoUrl && savedToken) {
          getCachedProfilePhoto(dbFotoUrl, savedToken).then((localUri) => {
            // Cache gagal -> jatuh ke URL remote, biar tetap ada peluang tampil.
            const uri = localUri || dbFotoUrl;
            setFailedPhotoUri(null);
            setProfileData((prev) => ({ ...prev, serverFotoUrl: uri }));
          });
        }
      }
    } catch (e) {
      console.error("Gagal load biodata", e);
    }
  };

  const handleResetReferenceFace = () => {
    if (resetQuota.remaining <= 0) {
      Alert.alert(
        "Batas Reset Tercapai",
        `Wajah terdaftar sudah direset ${resetQuota.max}x, batas maksimal sudah tercapai. Hubungi panitia KKN jika masih butuh reset.`,
      );
      return;
    }

    Alert.alert(
      "Reset Wajah Terdaftar?",
      `Seluruh set wajah terdaftar akan dihapus dari server dan perangkat ini. Anda harus mendaftar ulang (3-5 foto selfie di halaman LKH) sebelum bisa absen lagi. Sisa kesempatan reset: ${resetQuota.remaining} dari ${resetQuota.max}. Lanjutkan?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            const success = await resetEnrollment();
            if (!success) {
              Alert.alert("Gagal", "Batas reset sudah tercapai.");
              return;
            }
            await loadReferenceFaceState();
            Alert.alert(
              "Berhasil",
              "Wajah terdaftar dihapus. Buka halaman LKH dan tekan tombol absen untuk mendaftar ulang lewat 3-5 foto selfie.",
            );
          },
        },
      ],
    );
  };

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
            // Tab bar mengambang naik setinggi inset bawah - lihat catatan
            // yang sama di LKHScreen.tsx.
            paddingBottom: 110 + insets.bottom,
          },
        ]}
      >
        <View style={styles.glassShadow}>
          <View style={styles.avatarContainer}>
            {profileData.serverFotoUrl &&
            failedPhotoUri !== profileData.serverFotoUrl ? (
              <Image
                source={{
                  uri: profileData.serverFotoUrl,
                  // Header (Bearer + User-Agent yang diharapkan server) hanya
                  // untuk URL remote http(s); dikirim bersyarat agar aman untuk
                  // uri non-http.
                  ...(profileData.serverFotoUrl.startsWith("http")
                    ? { headers: profilePhotoHeaders(token) }
                    : {}),
                }}
                style={styles.avatarImage}
                // Catat URI-nya, bukan sekadar "gagal" - lihat failedPhotoUri.
                onError={() => setFailedPhotoUri(profileData.serverFotoUrl)}
              />
            ) : (
              <View style={[styles.avatarImage, styles.avatarFallback]}>
                <Text style={styles.avatarFallbackText}>
                  {initials(profileData.nama)}
                </Text>
              </View>
            )}
            <Text style={styles.nameText}>{profileData.nama}</Text>
            <Text style={styles.nimText}>{profileData.nim}</Text>

            <TouchableOpacity
              style={[
                styles.resetFaceButton,
                resetQuota.remaining <= 0 && styles.resetFaceButtonDisabled,
              ]}
              onPress={handleResetReferenceFace}
              activeOpacity={0.8}
            >
              <Ionicons
                name="refresh"
                size={16}
                color="#FFF"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.resetFaceText}>
                Reset Wajah Terdaftar ({resetQuota.remaining}/{resetQuota.max})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.glassShadow}>
          <View style={styles.tableCard}>
            <View style={styles.rowItem}>
              <Text style={styles.rowLabel}>Tanggal Lahir</Text>
              <Text style={styles.rowValue}>{profileData.tglLahir}</Text>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.rowLabel}>Program Studi</Text>
              <Text style={styles.rowValue}>{profileData.prodi}</Text>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.rowLabel}>Fakultas</Text>
              <Text style={styles.rowValue}>{profileData.fakultas}</Text>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.rowLabel}>Tahun Masuk</Text>
              <Text style={styles.rowValue}>{profileData.tahunMasuk}</Text>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.rowLabel}>Angkatan KKN</Text>
              <Text style={styles.rowValue}>{profileData.angkatan}</Text>
            </View>
            <View style={[styles.rowItem, styles.rowItemLast]}>
              <Text style={styles.rowLabel}>Lokasi KKN</Text>
              <Text style={styles.rowValue}>
                {profileData.kecamatan}, {profileData.kabupaten}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => {
            Alert.alert("Konfirmasi", "Yakin ingin keluar akun?", [
              { text: "Batal", style: "cancel" },
              {
                text: "Logout",
                style: "destructive",
                onPress: async () => {
                  await AsyncStorage.removeItem("@user_token");
                  await AsyncStorage.removeItem("@user_nim");
                  await AsyncStorage.removeItem("@user_id");
                  await AsyncStorage.removeItem("@user_role");
                  await AsyncStorage.removeItem("@user_profile");
                  // Cache program presensi terikat akun - buang saat logout.
                  await AsyncStorage.removeItem("@presensi_program_id");
                  // Sesi demo (Masuk Mode Demo di LoginScreen) menyalakan
                  // @demo_mode - matikan ikut di sini supaya sesi demo benar-
                  // benar berakhir saat logout dan login asli berikutnya tidak
                  // diam-diam masih membypass gerbang periode/geofence.
                  await AsyncStorage.removeItem("@demo_mode");
                  // Buang cache foto profil lokal supaya akun berikutnya tidak
                  // memakai foto akun sebelumnya.
                  await clearCachedProfilePhoto();
                  // Logout SENGAJA tidak menghapus wajah terdaftar.
                  // Aplikasi ini dipakai di perangkat pribadi mahasiswa
                  // sendiri (lihat PANDUAN-BUILD-IPA.md / alur sideload
                  // KSign), bukan perangkat bersama, jadi tidak ada
                  // "pergantian akun" yang perlu dilindungi - menghapusnya
                  // hanya memaksa daftar ulang tiap login, yang justru lebih
                  // buruk untuk anti-titip-absen. Sesi demo memakai
                  // namespace terpisah (lihat storageKeys di
                  // utils/faceEnrollment.ts), jadi tidak ikut terbawa.
                  onLogout();
                },
              },
            ]);
          }}
          activeOpacity={0.85}
        >
          <Ionicons
            name="log-out-outline"
            size={20}
            color="#FFF"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.logoutText}>LOGOUT</Text>
        </TouchableOpacity>

        {/* Aplikasi ini dipasang lewat sideload, sering beberapa build
            berturut-turut dalam sehari - tanpa ini tidak ada cara memastikan
            build mana yang benar-benar terpasang saat menguji perbaikan.
            Nomor build diisi otomatis dari nomor run GitHub Actions (lihat
            .github/workflows/build-ios.yml), jadi angka lebih besar = lebih
            baru. Ini versi APLIKASI, bukan APP_VERSION yang dikirim ke server
            di utils/deviceInfo.ts. */}
        <Text style={styles.versionText}>
          Versi {Constants.expoConfig?.version ?? "?"}
        </Text>
      </ScrollView>
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
    // Ruang bawah = tinggi tab bar mengambang + jarak aman, supaya tombol
    // LOGOUT & baris data terakhir (Lokasi KKN) tidak tertutup tab bar.
    paddingBottom: 110,
    alignItems: "center",
  },
  glassShadow: {
    width: "100%",
    borderRadius: 28,
    marginBottom: 16,
    shadowColor: "#3A4B5C",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  avatarContainer: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    width: "100%",
    padding: 22,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ECEFF3",
  },
  avatarImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: ACCENT,
    marginBottom: 12,
    backgroundColor: "#EEE",
  },
  // Avatar inisial saat tidak ada foto profil (seragam dengan sisi dosen).
  avatarFallback: {
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: "#FFF",
    fontSize: 40,
    fontWeight: "700",
  },
  nameText: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  nimText: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    marginTop: 2,
    marginBottom: 16,
  },
  resetFaceButton: {
    flexDirection: "row",
    backgroundColor: "#3C7A57",
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
  },
  resetFaceButtonDisabled: {
    backgroundColor: "#9AA5A0",
  },
  resetFaceText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 13,
  },
  tableCard: {
    backgroundColor: "#FFFFFF",
    width: "100%",
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ECEFF3",
  },
  rowItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(120,130,150,0.15)",
  },
  rowItemLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: "500",
  },
  rowValue: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    fontWeight: "600",
    textAlign: "right",
  },
  logoutButton: {
    flexDirection: "row",
    backgroundColor: "#D32F2F",
    width: "100%",
    paddingVertical: 15,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#D32F2F",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  logoutText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  versionText: {
    textAlign: "center",
    color: "#8E8E93",
    fontSize: 12,
    marginTop: 18,
  },
});
