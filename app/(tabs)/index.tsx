import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import LKHScreen from "../../components/LKHScreen";
import LoginScreen from "../../components/LoginScreen";
import PembimbingScreen from "../../components/PembimbingScreen";
import ProfilDosenScreen from "../../components/ProfilDosenScreen";
import ProfileScreen from "../../components/ProfileScreen";

export default function Index() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<"lkh" | "profile">("lkh");
  // Peran menentukan aplikasi mana yang tampil: peserta (LKH+Profil) atau
  // pembimbing (dashboard bimbingan). Disimpan saat login (@user_role).
  const [role, setRole] = useState<"peserta" | "pembimbing">("peserta");

  // Baca sesi + peran. Dipakai saat mount DAN dipanggil ulang setelah login
  // (onLoginSuccess) - tanpa itu, login pembimbing tetap menampilkan layar
  // peserta karena state peran belum disegarkan.
  const refreshAuth = async () => {
    try {
      const [token, savedRole] = await Promise.all([
        AsyncStorage.getItem("@user_token"),
        AsyncStorage.getItem("@user_role"),
      ]);
      setIsLoggedIn(!!token);
      setRole(savedRole === "pembimbing" ? "pembimbing" : "peserta");
    } catch (error) {
      console.error("Gagal mengecek status login", error);
    }
  };

  useEffect(() => {
    refreshAuth().finally(() => setIsCheckingAuth(false));
  }, []);

  if (isCheckingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <LoginScreen onLoginSuccess={refreshAuth} />
      </SafeAreaView>
    );
  }

  const isPembimbing = role === "pembimbing";

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Konten Berdasarkan Tab Aktif + peran. Peserta: LKH/Profil peserta;
          pembimbing: kalender kehadiran/Profil dosen. */}
      <View style={styles.content}>
        {currentTab === "lkh" ? (
          isPembimbing ? (
            <PembimbingScreen onLogout={refreshAuth} />
          ) : (
            <LKHScreen />
          )
        ) : isPembimbing ? (
          <ProfilDosenScreen onLogout={refreshAuth} />
        ) : (
          <ProfileScreen onLogout={() => setIsLoggedIn(false)} />
        )}
      </View>

      {/* Tab bar mengambang ala iOS: kartu putih membulat. Dulu BlurView
          (kaca), tapi di Android BlurView tidak meng-clip ke borderRadius -
          tab bar malah tampak KOTAK. View solid membulat lebih konsisten. */}
      <View style={styles.tabBarWrap}>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => setCurrentTab("lkh")}
            activeOpacity={0.75}
          >
            <View style={[styles.tabPill, currentTab === "lkh" && styles.tabPillActive]}>
              <FontAwesome5
                name="calendar-alt"
                size={17}
                color={currentTab === "lkh" ? "#059669" : "#3A4453"}
              />
              <Text
                style={[
                  styles.tabText,
                  currentTab === "lkh" && styles.tabTextActive,
                ]}
              >
                LKH
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => setCurrentTab("profile")}
            activeOpacity={0.75}
          >
            <View
              style={[styles.tabPill, currentTab === "profile" && styles.tabPillActive]}
            >
              <Ionicons
                name="person"
                size={18}
                color={currentTab === "profile" ? "#059669" : "#3A4453"}
              />
              <Text
                style={[
                  styles.tabText,
                  currentTab === "profile" && styles.tabTextActive,
                ]}
              >
                Profil
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F1F5F9",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
  },
  content: {
    flex: 1,
    // Menyisakan ruang di bawah supaya konten (termasuk tombol yang
    // posisinya absolute di dalam LKHScreen/ProfileScreen) tidak ketimpa
    // tab bar melayang (wrapper bottom:10 + tinggi tabBar 64 + jarak aman).
    paddingBottom: 0,
  },

  // Bungkus luar: cuma untuk shadow + posisi melayang.
  tabBarWrap: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 14,
    height: 62,
    borderRadius: 31,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 8,
  },
  // Bar kaca asli (BlurView) - overlay warnanya sengaja sangat tipis supaya
  // efek buramnya yang terlihat, bukan warna solid ("kotak").
  tabBar: {
    flex: 1,
    flexDirection: "row",
    borderRadius: 31,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ECEFF3",
    backgroundColor: "#FFFFFF",
  },
  // Area sentuh: separuh lebar bar x tinggi penuh - jauh lebih besar dari
  // ukuran ikon/teksnya sendiri, supaya tidak mudah salah tindis.
  tabItem: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  // Pil di dalam area sentuh, sedikit lebih kecil dari sel-nya (ala iOS 26 /
  // Instagram terbaru) - ini yang tampak, tapi bukan penentu area sentuh.
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    width: "88%",
    borderRadius: 22,
    // TANPA overflow:hidden - SENGAJA. Di Android Fabric, View ber-overflow
    // "hidden" yang TIDAK punya background (yaitu pil saat NON-AKTIF) gagal
    // menggambar ulang anak-anaknya setelah transisi aktif->non-aktif: klip
    // tetap diterapkan tapi ikon+teks tak ikut digambar lagi, jadi tab non-aktif
    // tampak KOSONG. Latar hijau translucent pil AKTIF tetap membulat sempurna
    // dari borderRadius saja - Android menggambar background rounded secara
    // native tanpa perlu overflow:hidden (itu cuma perlu untuk meng-clip ANAK
    // yang keluar bidang, sedangkan ikon+teks di sini selalu di tengah).
  },
  // Aksen "liquid glass" hijau: bukan hijau solid, tapi kaca tipis
  // berwarna hijau dengan tepi menyala lembut, seperti tetesan cairan.
  //
  // TANPA elevation (bayangan Android) - SENGAJA. Di Android New Architecture
  // (Fabric), View yang punya `elevation` dipromosikan ke layer render sendiri;
  // saat pil berpindah aktif->non-aktif, elevation dicabut dan view turun ke
  // layer induk (yang ber-overflow:hidden), tetapi Fabric GAGAL menggambar
  // ulang anak-anaknya (ikon+teks) sehingga tab non-aktif tampak KOSONG. Cukup
  // pakai warna latar + border sebagai penanda aktif. Bayangan iOS (shadow*)
  // tetap dipertahankan - iOS memakai shadow*, bukan elevation, dan tidak kena
  // bug ini.
  tabPillActive: {
    backgroundColor: "rgba(16,185,129,0.22)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.55)",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  tabText: {
    fontSize: 13,
    color: "#3A4453",
    fontWeight: "700",
    marginLeft: 7,
  },
  tabTextActive: {
    color: "#059669",
  },
});
