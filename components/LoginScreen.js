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

const HIJAU = "#0B753A";
const WARNA_TIDAK_AKTIF = "#4B6455";

// Label "Login Peserta" dan "Login Dosen" dipertahankan apa adanya: naskah
// skripsi menyebut kedua label ini secara harfiah.
const PILIHAN_PERAN = [
  { kunci: "peserta", label: "Login Peserta", ikon: "user-graduate" },
  { kunci: "dosen", label: "Login Dosen", ikon: "chalkboard-teacher" },
];

export default function LoginScreen({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("peserta");
  const [nim, setNim] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Kolom yang sedang diisi diberi garis tepi hijau.
  const [fokus, setFokus] = useState(null);

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
              "pembimbing, masuk lewat tab Login Dosen.\n\n" +
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
            "peserta KKN, masuk lewat tab Login Peserta.\n\n" +
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

          {/* PEMILIH PERAN. Dahulu dua tombol ini sama-sama hijau (#0B753A
              untuk yang aktif, #1F8B4C untuk yang tidak), sehingga sulit
              dibedakan mana yang sedang dipilih - dan salah pilih berujung
              pada login yang ditolak. Sekarang yang aktif hijau pekat
              berhuruf putih, yang tidak aktif menyatu dengan alasnya. */}
          <Text style={styles.roleLabel}>Pilih jenis akun</Text>
          <View style={styles.roleTrack}>
            {PILIHAN_PERAN.map((pilihan) => {
              const aktif = activeTab === pilihan.kunci;
              return (
                <TouchableOpacity
                  key={pilihan.kunci}
                  style={[styles.roleOption, aktif && styles.roleOptionActive]}
                  onPress={() => setActiveTab(pilihan.kunci)}
                  disabled={isLoading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: aktif }}
                  accessibilityLabel={pilihan.label}
                >
                  <FontAwesome5
                    name={pilihan.ikon}
                    size={15}
                    color={aktif ? "#FFFFFF" : WARNA_TIDAK_AKTIF}
                    style={styles.roleIcon}
                  />
                  <Text style={[styles.roleText, aktif && styles.roleTextActive]}>
                    {pilihan.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.instructionText}>
            {activeTab === "dosen"
              ? "Masukkan NIP dan password Portal Anda."
              : "Masukkan NIM dan password Portal Anda."}
          </Text>

          <View
            style={[
              styles.inputContainer,
              fokus === "nim" && styles.inputContainerFocused,
            ]}
          >
            <FontAwesome5
              name="user"
              size={18}
              color={fokus === "nim" ? HIJAU : "#666"}
              style={styles.inputIconLeft}
            />
            <TextInput
              style={styles.input}
              placeholder={activeTab === "dosen" ? "NIP" : "NIM"}
              placeholderTextColor="#999"
              value={nim}
              onChangeText={setNim}
              onFocus={() => setFokus("nim")}
              onBlur={() => setFokus(null)}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
          </View>

          <View
            style={[
              styles.inputContainer,
              fokus === "password" && styles.inputContainerFocused,
            ]}
          >
            <FontAwesome5
              name="key"
              size={18}
              color={fokus === "password" ? HIJAU : "#666"}
              style={styles.inputIconLeft}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFokus("password")}
              onBlur={() => setFokus(null)}
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
                <Text style={styles.loginButtonText}>
                  {activeTab === "dosen"
                    ? "Masuk sebagai Dosen"
                    : "Masuk sebagai Peserta"}
                </Text>
              </View>
            )}
          </TouchableOpacity>
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
  roleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#5F6F65",
    textAlign: "center",
    marginBottom: 8,
  },
  roleTrack: {
    flexDirection: "row",
    backgroundColor: "#E6F0E8",
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  roleOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 9,
  },
  roleOptionActive: {
    backgroundColor: HIJAU,
  },
  roleIcon: {
    marginRight: 7,
  },
  roleText: {
    color: WARNA_TIDAK_AKTIF,
    fontWeight: "600",
    fontSize: 13,
  },
  roleTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  instructionText: {
    fontSize: 13,
    color: "#444",
    textAlign: "center",
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CCC",
    borderRadius: 10,
    marginBottom: 14,
    backgroundColor: "#FAFAFA",
  },
  inputContainerFocused: {
    borderColor: HIJAU,
    backgroundColor: "#FFFFFF",
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
    backgroundColor: HIJAU,
    borderRadius: 10,
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
  footerText: {
    marginTop: 20,
    color: "#333",
    fontSize: 14,
    fontWeight: "500",
  },
});
