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

import { getDeviceInfoObject, APP_VERSION, API_USER_AGENT } from "../utils/deviceInfo";
import { API_BASE } from "../utils/api";
import { fetchPembimbing } from "../utils/pembimbingApi";
import { MODE_LOKAL, masukDemo } from "../utils/modeLokal";
import Constants from "expo-constants";

/**
 * Hapus seluruh jejak sesi. Dipanggil saat login DITOLAK karena perannya tidak
 * cocok, supaya tidak ada token/profil separuh jadi yang tertinggal dan dipakai
 * layar berikutnya.
 */
async function hapusSesi() {
  await AsyncStorage.multiRemove([
    "@user_token",
    "@user_nim",
    "@user_role",
    "@user_profile",
    "@user_id",
  ]);
}

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
        // Sesi SENGAJA belum ditulis di sini. /auth/get-token hanya memeriksa
        // kredensial dan TIDAK membedakan peran, jadi kalau peran ditulis
        // sebelum diverifikasi, NIP dosen ikut masuk sebagai peserta. Sesi
        // baru ditulis setelah /api/peserta membuktikan akun ini peserta.

        // 2. Ambil data profil HANYA dari endpoint /api/peserta - sekaligus
        //    menjadi bukti peran.
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
              // Radius area presensi (meter) yang diatur admin per kecamatan -
              // dipakai bersama koordinat di atas, persis seperti aplikasi
              // Flutter resmi (validasiLokasiMaps). Lihat utils/geofence.ts.
              poskoRadius: Number.isFinite(Number(data.wilayahKec?.setting?.radius))
                ? Number(data.wilayahKec.setting.radius)
                : null,
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

            // Peran terbukti - sesi ditulis sekaligus di sini, bukan sebelum
            // pemeriksaan.
            await AsyncStorage.multiSet([
              ["@user_token", result.token],
              ["@user_nim", nim],
              // Peran menentukan layar setelah login (lihat app/(tabs)/index.tsx).
              ["@user_role", "peserta"],
              ["@user_profile", JSON.stringify(combinedProfile)],
            ]);
            // Kunci id numerik untuk endpoint wajah (lihat komentar di atas).
            if (data.id != null) {
              await AsyncStorage.setItem("@user_id", String(data.id));
            }
          } else {
            throw new Error(
              pesertaJson.desc ||
                pesertaJson.message ||
                "Akun tidak ditemukan pada data peserta",
            );
          }
        } catch (err) {
          // Dulu di sini ada profil cadangan "Peserta KKN" dan login TETAP
          // diteruskan. Itulah yang membuat NIP dosen bisa masuk sebagai
          // mahasiswa: /api/peserta menolak NIP, lalu profil cadangan menutupi
          // penolakan itu. Sekarang login dibatalkan dan sesi dibersihkan.
          console.error("Verifikasi peran peserta gagal:", err);
          await hapusSesi();
          Alert.alert(
            "Gagal Login",
            "Akun ini tidak terdaftar sebagai peserta KKN. Bila Anda dosen " +
              "pembimbing, masuk lewat tab Pembimbing.\n\n" +
              `[debug] ${err?.message ?? err}`,
          );
          return;
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

      // Sesi belum ditulis di sini - sama alasannya dengan sisi peserta:
      // get-token tidak membedakan peran, jadi peran harus dibuktikan dulu.

      // Profil pembimbing: /api/pembimbing mengembalikan id/kode/nama/pegFoto
      // + pegTglLahir, angkatan, peran, prodi.fakultas (lihat ProfilDosenScreen).
      try {
        const p = await fetchPembimbing(nim, result.token);
        // Pemeriksaan bentuk data ini WAJIB eksplisit. unwrap() di utils/api.ts
        // mengembalikan AMPLOP respons saat `data` null (fallback
        // `parsed.data ?? parsed`, dipakai endpoint tanpa `data` seperti
        // max-reset), jadi untuk NIM peserta fetchPembimbing TIDAK melempar
        // galat - ia mengembalikan {statusCode, desc} yang lolos begitu saja
        // dan dulu menjadi profil {nip: <NIM>, nama: "Pembimbing"}.
        const sahih =
          p && typeof p === "object" && p.nama && (p.id != null || p.kode);
        if (!sahih) {
          throw new Error("Respons tidak memuat data pembimbing");
        }
        const profile = {
          nip: p.kode ?? nim,
          nama: p.nama,
          foto: p.pegFoto ?? p.foto ?? "",
          tglLahir: p.pegTglLahir ?? "",
          prodi: p.prodi?.nama ?? "",
          fakultas: p.prodi?.fakultas?.nama ?? "",
          angkatan: p.angkatan?.nama_angkatan?.toString() ?? "",
          peran: p.peran?.nama ?? "Dosen Pembimbing",
        };
        await AsyncStorage.multiSet([
          ["@user_token", result.token],
          ["@user_nim", nim],
          ["@user_role", "pembimbing"],
          ["@user_profile", JSON.stringify(profile)],
        ]);
        if (p.id != null) await AsyncStorage.setItem("@user_id", String(p.id));
      } catch (profileErr) {
        // Dulu di sini ada profil minimal dan login tetap diteruskan - itu
        // yang membuat NIM mahasiswa bisa masuk sebagai dosen.
        console.error("Verifikasi peran pembimbing gagal:", profileErr);
        await hapusSesi();
        Alert.alert(
          "Gagal Login",
          "Akun ini tidak terdaftar sebagai dosen pembimbing. Bila Anda " +
            "peserta KKN, masuk lewat tab Peserta.\n\n" +
            `[debug] ${profileErr?.message ?? profileErr}`,
        );
        return;
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

          {/* Tombol demo. Hanya ada pada build MODE LOKAL (EXPO_PUBLIC_SUMBER
              =lokal); pada build biasa seluruh blok ini tidak dirender, jadi
              tidak ada pintu masuk tanpa sandi di aplikasi yang sebenarnya.
              Perannya mengikuti tab aktif, supaya satu tombol melayani dua
              peran tanpa menambah kekacauan di layar. */}
          {MODE_LOKAL && (
            <>
              <TouchableOpacity
                style={styles.demoButton}
                onPress={async () => {
                  await masukDemo(activeTab === "dosen" ? "pembimbing" : "peserta");
                  if (onLoginSuccess) onLoginSuccess();
                }}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <View style={styles.buttonContent}>
                  <MaterialCommunityIcons
                    name="flask-outline"
                    size={20}
                    color="#1D6F42"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.demoButtonText}>
                    {activeTab === "dosen"
                      ? "MASUK DEMO - DOSEN"
                      : "MASUK DEMO - MAHASISWA"}
                  </Text>
                </View>
              </TouchableOpacity>
              <Text style={styles.demoNote}>
                Mode demo: data contoh, tidak terhubung server.
              </Text>
            </>
          )}
        </View>

        {/* Angkanya dibaca dari app.json, bukan ditulis tangan seperti
            sebelumnya - versi hardcode di sini sempat menyimpang dari versi
            aplikasi yang sebenarnya. Ini versi APLIKASI; APP_VERSION di
            utils/deviceInfo.ts adalah hal berbeda yang dikirim ke server. */}
        <Text style={styles.footerText}>
          Versi {Constants.expoConfig?.version ?? "?"}
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
  // Tombol demo dibuat BERGARIS, bukan terisi, supaya jelas bukan tombol
  // utama dan tidak tertukar dengan LOGIN saat diperagakan.
  demoButton: {
    backgroundColor: "#FFF",
    borderWidth: 1.5,
    borderColor: "#1D6F42",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  demoButtonText: {
    color: "#1D6F42",
    fontSize: 14,
    fontWeight: "bold",
  },
  demoNote: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 11,
    color: "#777",
  },
  loginButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  footerText: {
    marginTop: 20,
    color: "#333",
    fontSize: 14,
    fontWeight: "500",
  },
});
