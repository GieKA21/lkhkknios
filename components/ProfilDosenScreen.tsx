import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { pembimbingPhotoUrl, profilePhotoHeaders } from "../utils/api";

interface ProfilDosenScreenProps {
  onLogout: () => void;
}

interface DosenProfile {
  nip?: string;
  nama?: string;
  foto?: string;
  tglLahir?: string;
  prodi?: string;
  fakultas?: string;
  angkatan?: string;
  peran?: string;
}

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfilDosenScreen({ onLogout }: ProfilDosenScreenProps) {
  const [profile, setProfile] = useState<DosenProfile>({});
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    (async () => {
      const [raw, tok] = await Promise.all([
        AsyncStorage.getItem("@user_profile"),
        AsyncStorage.getItem("@user_token"),
      ]);
      setToken(tok || "");
      if (raw) {
        try {
          setProfile(JSON.parse(raw));
        } catch {
          // profil rusak - biarkan kosong
        }
      }
    })();
  }, []);

  const confirmLogout = () => {
    Alert.alert("Konfirmasi", "Yakin ingin keluar akun?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.multiRemove([
            "@user_token",
            "@user_nim",
            "@user_id",
            "@user_profile",
            "@user_role",
            "@demo_mode",
            "@presensi_program_id",
          ]);
          onLogout();
        },
      },
    ]);
  };

  const rows: { label: string; value: string }[] = [
    { label: "NIP", value: profile.nip || "-" },
    { label: "Nama", value: profile.nama || "-" },
    { label: "Tanggal Lahir", value: profile.tglLahir || "-" },
    { label: "Program Studi", value: profile.prodi || "-" },
    { label: "Fakultas", value: profile.fakultas || "-" },
  ];
  const rows2: { label: string; value: string }[] = [
    { label: "Angkatan", value: profile.angkatan || "-" },
    { label: "Peran", value: profile.peran || "Dosen Pembimbing" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.photoWrap}>
          {profile.foto ? (
            <Image
              source={{
                uri: pembimbingPhotoUrl(profile.foto),
                headers: profilePhotoHeaders(token),
              }}
              style={styles.photo}
            />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <Text style={styles.photoInitials}>
                {initials(profile.nama || "")}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={confirmLogout}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={20} color="#FFF" />
          <Text style={styles.logoutText}>LOGOUT</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {rows.map((r, i) => (
            <View
              key={r.label}
              style={[styles.row, i < rows.length - 1 && styles.rowDivider]}
            >
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          {rows2.map((r, i) => (
            <View
              key={r.label}
              style={[styles.row, i < rows2.length - 1 && styles.rowDivider]}
            >
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.versionText}>
          Versi {Constants.expoConfig?.version ?? "?"} (build{" "}
          {Constants.expoConfig?.ios?.buildNumber ?? "?"})
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const ACCENT = "#0E783D";
const TEXT_PRIMARY = "#1C1C1E";
const TEXT_SECONDARY = "#6E6E73";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EEF1F6" },
  content: { padding: 20, paddingBottom: 120, alignItems: "center" },
  photoWrap: { marginTop: 12, marginBottom: 20 },
  photo: {
    width: 150,
    height: 190,
    borderRadius: 12,
    backgroundColor: "#E4E9EF",
  },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  photoInitials: { fontSize: 44, fontWeight: "800", color: ACCENT },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    backgroundColor: "#C0392B",
    paddingVertical: 14,
    borderRadius: 26,
    marginBottom: 20,
    shadowColor: "#C0392B",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  logoutText: { color: "#FFF", fontWeight: "800", letterSpacing: 0.5 },
  card: {
    alignSelf: "stretch",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E4E9EF",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E4E9EF",
  },
  rowLabel: { width: 120, fontSize: 13.5, color: TEXT_SECONDARY },
  rowValue: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    textAlign: "right",
  },
  versionText: { color: "#8E8E93", fontSize: 11, marginTop: 8 },
});
