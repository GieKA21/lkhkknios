import { FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { startDemoSession, startDemoPembimbingSession } from "../utils/demoMode";
import { getDeviceInfoObject, APP_VERSION, API_USER_AGENT } from "../utils/deviceInfo";
import { API_BASE } from "../utils/api";
import { fetchPembimbing } from "../utils/pembimbingApi";
import Constants from "expo-constants";

export default function LoginScreen({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("peserta");
  const [nim, setNim] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!nim || !password) {
      Alert.alert("Perhatian", "NIM dan Password tidak boleh kosong!");
      return;
    }

    setIsLoading(true);

    const deviceInfoStr = JSON.stringify(getDeviceInfoObject());

    try {
      const formData = new FormData();
      formData.append("username", nim);
      formData.append("password", password);
      formData.append("version", APP_VERSION);
      formData.append("device_info", deviceInfoStr);

      // 1. Request Token Login
      const response = await fetch(
        `${API_BASE}/auth/get-token`,
        {
          method: "POST",
          headers: { "User-Agent": API_USER_AGENT },
          body: formData,
        },
      );

      // Parse aman: kalau WAF/Cloudflare membalas HTML block page,
      // response.json() melempar SyntaxError yang dulu jatuh ke alert
      // "kesalahan koneksi" dan menyembunyikan penyebab sebenarnya.
      const rawText = await response.text();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch (_parseError) {
        console.error(
          "get-token: respons non-JSON:",
          response.status,
          rawText.slice(0, 300),
        );
        Alert.alert(
          "Gagal Login",
          `Server merespons non-JSON (HTTP ${response.status}). Kemungkinan request diblokir Cloudflare/WAF - coba lagi beberapa saat.`,
        );
        return;
      }

      // DIAGNOSTIK: respons error endpoint ini TIDAK punya field `desc`
      // (format Yii: {name, message}), dan dulu semua kegagalan tampil
      // sebagai "NIM atau Password salah!" walau penyebabnya lain (akun
      // terkunci, versi ditolak, SSO portal down, dst). Tampilkan pesan
      // asli server + log mentahnya untuk diagnosis login.
      if (!(response.ok && result.token)) {
        console.error(
          "get-token gagal:",
          response.status,
          JSON.stringify(result),
        );
      }

      if (response.ok && result.token) {
        await AsyncStorage.setItem("@user_token", result.token);
        await AsyncStorage.setItem("@user_nim", nim);
        // Peran menentukan layar setelah login (lihat app/(tabs)/index.tsx).
        await AsyncStorage.setItem("@user_role", "peserta");

        // 2. Ambil data profil HANYA dari endpoint /api/peserta
        try {
          const pesertaRes = await fetch(
            `${API_BASE}/api/peserta?nim=${nim}&device_info=${encodeURIComponent(deviceInfoStr)}&version=${APP_VERSION}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${result.token}`,
                "User-Agent": API_USER_AGENT,
              },
            },
          );
          const pesertaJson = await pesertaRes.json();

          if (pesertaJson.statusCode === 200 && pesertaJson.data) {
            const data = pesertaJson.data;

            // Mapping JSON yang presisi untuk menghindari [object Object] dan data kosong
            const combinedProfile = {
              // ID NUMERIK peserta - beda dari `nim`/`kode`. Endpoint wajah
              // server (/api/simpan-face-data, /api/face-data) memakai `id`
              // ini sebagai kunci, BUKAN nim (dipastikan dari source Flutter
              // resmi: postSimpanFaceData(peserta.id, ...)). Disimpan supaya
              // sinkronisasi wajah lintas-perangkat memakai kunci yang benar.
              id: data.id ?? null,
              nim: data.kode || nim,
              nama: data.nama || "Peserta KKN",
              foto: data.foto || data.mhsFoto || "274131.jpg",
              tglLahir: data.mhsTanggalLahir || "",
              prodi: data.prodi?.nama || "",
              fakultas: data.prodi?.fakultas?.nama || "",
              tahunMasuk: data.mhsTahunAjaran?.toString() || "",
              angkatan: data.angkatan?.nama_angkatan?.toString() || "",
              kecamatan: data.wilayahKec?.nama || "",
              kabupaten:
                data.wilayahKec?.atas?.nama || data.wilayahKab?.nama || "",
              // Dipakai untuk geofencing absensi (lihat utils/geofence.ts).
              // Field ini ada di server tapi sering kosong (belum diisi
              // admin) - kalau kosong, geofence otomatis fallback ke
              // geocoding nama kecamatan+kabupaten di atas.
              poskoKoordinat: data.wilayahKec?.setting?.koordinat || null,
              // Periode KKN dipakai untuk kalender di LKHScreen.tsx (lihat
              // isWithinKKNPeriod). Server punya dua sumber: periode per
              // angkatan (umum) dan periode per lokasi/kecamatan (setting -
              // bisa beda-beda tanggal mulai tergantung posko). Keduanya
              // dikirim, LKHScreen yang memutuskan mana yang dipakai.
              angkatanTanggalMulai: data.angkatan?.tanggal_mulai || null,
              angkatanTanggalSelesai: data.angkatan?.tanggal_selesai || null,
              settingTanggalMulai: data.wilayahKec?.setting?.tanggal_mulai || null,
              settingTanggalSelesai:
                data.wilayahKec?.setting?.tanggal_selesai || null,
              // ID numerik angkatan & wilayah - dibutuhkan saat MEMBUAT
              // program default untuk presensi (server /api/simpan-program
              // meminta angkatan_id + wilayah_id). Lihat utils/presensiProgram.ts.
              // Wilayah: sebagian akun diset di level KELURAHAN (wilayahKel),
              // sebagian hanya KECAMATAN (wilayahKec, kolom pengguna.
              // wilayah_id_kec) - pakai kelurahan bila ada, jika tidak
              // kecamatan. Tanpa fallback ini wilayahId kosong untuk akun
              // yang hanya punya kecamatan.
              angkatanId: data.angkatan?.id ?? null,
              wilayahId: data.wilayahKel?.id ?? data.wilayahKec?.id ?? null,
            };

            await AsyncStorage.setItem(
              "@user_profile",
              JSON.stringify(combinedProfile),
            );
            // Kunci id numerik untuk endpoint wajah (lihat komentar di atas).
            if (data.id != null) {
              await AsyncStorage.setItem("@user_id", String(data.id));
            }
          } else {
            throw new Error("Format respons API peserta tidak sesuai");
          }
        } catch (err) {
          console.error(
            "Gagal mengunduh profil, menggunakan data fallback:",
            err,
          );
          const defaultProfile = {
            nim: nim,
            nama: "Peserta KKN",
            foto: "274131.jpg",
            tglLahir: "",
            prodi: "",
            fakultas: "",
            tahunMasuk: "",
            angkatan: "",
            kecamatan: "",
            kabupaten: "",
            poskoKoordinat: null,
            angkatanTanggalMulai: null,
            angkatanTanggalSelesai: null,
            settingTanggalMulai: null,
            settingTanggalSelesai: null,
          };
          await AsyncStorage.setItem(
            "@user_profile",
            JSON.stringify(defaultProfile),
          );
        }

        Alert.alert("Berhasil", "Login Berhasil!", [
          {
            text: "OK",
            onPress: () => {
              if (onLoginSuccess) {
                onLoginSuccess();
              }
            },
          },
        ]);
      } else {
        // Pesan asli server dipertahankan (desc untuk format lama, message
        // untuk format error Yii) - jangan diubah jadi "password salah"
        // generik karena menyembunyikan penyebab sebenarnya. Detail debug
        // (status HTTP + potongan body mentah) sengaja ikut ditampilkan:
        // semua kegagalan endpoint ini balasannya identik generik, jadi
        // isi mentahnya satu-satunya petunjuk penyebab sebenarnya.
        const detail =
          result.desc || result.message || "(server tidak mengirim pesan)";
        Alert.alert(
          "Gagal Login",
          `${detail}\n\n[debug] HTTP ${response.status} | body: ${rawText.slice(0, 200)}`,
        );
      }
    } catch (error) {
      console.error("Login Error:", error);
      Alert.alert("Error", "Terjadi kesalahan koneksi ke server.");
    } finally {
      setIsLoading(false);
    }
  };

  // Login PEMBIMBING (dosen). Alur mengikuti source Flutter resmi
  // (doLoginPembimbing): auth get-token yang SAMA, lalu ambil profil lewat
  // /api/pembimbing dengan NIP (field input dipakai sebagai NIP di tab dosen).
  // Tidak ada enrollment wajah di sisi pembimbing - langsung ke dashboard.
  const handleLoginPembimbing = async () => {
    if (!nim || !password) {
      Alert.alert("Perhatian", "NIP dan Password tidak boleh kosong!");
      return;
    }
    setIsLoading(true);
    const deviceInfoStr = JSON.stringify(getDeviceInfoObject());
    try {
      const formData = new FormData();
      formData.append("username", nim);
      formData.append("password", password);
      formData.append("version", APP_VERSION);
      formData.append("device_info", deviceInfoStr);

      const response = await fetch(`${API_BASE}/auth/get-token`, {
        method: "POST",
        headers: { "User-Agent": API_USER_AGENT },
        body: formData,
      });
      const rawText = await response.text();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch (_e) {
        Alert.alert(
          "Gagal Login",
          `Server merespons non-JSON (HTTP ${response.status}). Kemungkinan diblokir WAF - coba lagi.`,
        );
        return;
      }

      if (!(response.ok && result.token)) {
        const detail =
          result.desc || result.message || "(server tidak mengirim pesan)";
        Alert.alert(
          "Gagal Login",
          `${detail}\n\n[debug] HTTP ${response.status} | body: ${rawText.slice(0, 200)}`,
        );
        return;
      }

      await AsyncStorage.setItem("@user_token", result.token);
      await AsyncStorage.setItem("@user_nim", nim);
      await AsyncStorage.setItem("@user_role", "pembimbing");

      // Profil pembimbing: /api/pembimbing mengembalikan id/kode/nama/pegFoto.
      try {
        const p = await fetchPembimbing(nim, result.token);
        const profile = {
          nip: p.kode ?? nim,
          nama: p.nama ?? "Pembimbing",
          foto: p.pegFoto ?? p.foto ?? "",
          prodi: p.prodi?.nama ?? "",
          fakultas: p.prodi?.fakultas?.nama ?? "",
        };
        await AsyncStorage.setItem("@user_profile", JSON.stringify(profile));
        if (p.id != null) await AsyncStorage.setItem("@user_id", String(p.id));
      } catch (_profileErr) {
        // Profil gagal diambil - tetap masuk dengan profil minimal supaya
        // dashboard bisa mencoba menarik daftar bimbingan sendiri.
        await AsyncStorage.setItem(
          "@user_profile",
          JSON.stringify({ nip: nim, nama: "Pembimbing", foto: "" }),
        );
      }

      Alert.alert("Berhasil", "Login pembimbing berhasil!", [
        { text: "OK", onPress: () => onLoginSuccess && onLoginSuccess() },
      ]);
    } catch (error) {
      console.error("Login Pembimbing Error:", error);
      Alert.alert("Error", "Terjadi kesalahan koneksi ke server.");
    } finally {
      setIsLoading(false);
    }
  };

  // Demo pembimbing: sesi lokal tanpa server (sample data di PembimbingScreen),
  // supaya sisi pembimbing bisa didemokan tanpa akun dosen di server dev.
  const handleDemoPembimbing = () => {
    Alert.alert(
      "Masuk Demo Pembimbing",
      "Mode demo pembimbing memakai data mahasiswa contoh tanpa menghubungi server. Cocok untuk mencoba tampilan sisi pembimbing sebelum ada akun dosen.",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Masuk Demo",
          onPress: async () => {
            try {
              await startDemoPembimbingSession();
              if (onLoginSuccess) onLoginSuccess();
            } catch (e) {
              console.error("Gagal masuk demo pembimbing:", e);
              Alert.alert("Error", "Gagal menyiapkan sesi demo pembimbing.");
            }
          },
        },
      ],
    );
  };

  // Login lokal tanpa server: akun KKN terikat periode angkatan, jadi setelah
  // masa KKN selesai server menolak login selamanya (401 "invalid credentials"
  // di semua varian request - lihat scripts/login-probe*.ps1). Sesi demo
  // memakai token dummy + mode demo aktif, sehingga catatan absen ter-tag
  // isDemo dan tidak pernah dikirim ke server asli.
  const handleDemoLogin = () => {
    Alert.alert(
      "Masuk Mode Demo",
      "Mode demo memakai profil dummy tanpa menghubungi server. Catatan absensi ditandai demo dan TIDAK akan dikirim ke server.\n\nCocok untuk mencoba fitur saat akun KKN sudah tidak aktif.",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Masuk Demo",
          onPress: async () => {
            try {
              await startDemoSession();
              if (onLoginSuccess) {
                onLoginSuccess();
              }
            } catch (e) {
              console.error("Gagal masuk mode demo:", e);
              Alert.alert("Error", "Gagal menyiapkan sesi demo.");
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appTitle}>Laporan Kerja Harian KKN</Text>
          </View>

          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === "peserta"
                  ? styles.tabActivePeserta
                  : styles.tabInactive,
              ]}
              onPress={() => setActiveTab("peserta")}
              activeOpacity={0.8}
            >
              <FontAwesome5
                name="book"
                size={16}
                color="#FFF"
                style={styles.tabIcon}
              />
              <Text style={styles.tabText}>Login Peserta</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === "dosen"
                  ? styles.tabActiveDosen
                  : styles.tabInactive,
              ]}
              onPress={() => setActiveTab("dosen")}
              activeOpacity={0.8}
            >
              <FontAwesome5
                name="graduation-cap"
                size={16}
                color="#FFF"
                style={styles.tabIcon}
              />
              <Text style={styles.tabText}>Login Dosen</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.instructionText}>
            {activeTab === "dosen"
              ? "Silahkan Masukkan NIP dan Password Portal Anda."
              : "Silahkan Masukkan NIM dan Password Portal Anda."}
          </Text>

          <View style={styles.inputContainer}>
            <FontAwesome5
              name="user"
              size={18}
              color="#666"
              style={styles.inputIconLeft}
            />
            <TextInput
              style={styles.input}
              placeholder={activeTab === "dosen" ? "NIP" : "NIM"}
              placeholderTextColor="#999"
              value={nim}
              onChangeText={setNim}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <FontAwesome5
              name="key"
              size={18}
              color="#666"
              style={styles.inputIconLeft}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.inputIconRight}
            >
              <FontAwesome5
                name={showPassword ? "eye" : "eye-slash"}
                size={18}
                color="#666"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.loginButton}
            onPress={activeTab === "dosen" ? handleLoginPembimbing : handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <View style={styles.buttonContent}>
                <MaterialCommunityIcons
                  name="login-variant"
                  size={22}
                  color="#FFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.loginButtonText}>LOGIN</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.demoButton}
            onPress={
              activeTab === "dosen" ? handleDemoPembimbing : handleDemoLogin
            }
            activeOpacity={0.8}
          >
            <View style={styles.buttonContent}>
              <MaterialCommunityIcons
                name="flask-outline"
                size={20}
                color="#0B753A"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.demoButtonText}>
                {activeTab === "dosen"
                  ? "MASUK DEMO PEMBIMBING"
                  : "MASUK MODE DEMO"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Angkanya dibaca dari app.json, bukan ditulis tangan seperti
            sebelumnya - versi hardcode di sini sempat menyimpang dari versi
            aplikasi yang sebenarnya. Ini versi APLIKASI; APP_VERSION di
            utils/deviceInfo.ts adalah hal berbeda yang dikirim ke server. */}
        <Text style={styles.footerText}>
          Versi {Constants.expoConfig?.version ?? "?"} (build{" "}
          {Constants.expoConfig?.ios?.buildNumber ?? "?"})
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#98C58B",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    width: "100%",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  tabContainer: {
    flexDirection: "row",
    marginBottom: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  tabActivePeserta: {
    backgroundColor: "#0B753A",
  },
  tabActiveDosen: {
    backgroundColor: "#0B753A",
  },
  tabInactive: {
    backgroundColor: "#1F8B4C",
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 13,
  },
  instructionText: {
    fontSize: 13,
    color: "#444",
    textAlign: "center",
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CCC",
    borderRadius: 8,
    marginBottom: 14,
    backgroundColor: "#FAFAFA",
  },
  inputIconLeft: {
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: "#333",
  },
  inputIconRight: {
    paddingHorizontal: 12,
  },
  loginButton: {
    backgroundColor: "#0E783D",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  loginButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  demoButton: {
    borderWidth: 1.5,
    borderColor: "#0B753A",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  demoButtonText: {
    color: "#0B753A",
    fontSize: 14,
    fontWeight: "bold",
  },
  footerText: {
    marginTop: 20,
    color: "#333",
    fontSize: 14,
    fontWeight: "500",
  },
});
