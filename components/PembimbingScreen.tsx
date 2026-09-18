import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { DEMO_TOKEN } from "../utils/demoMode";
import {
  fetchSupervisedStudents,
  type SupervisedStudent,
} from "../utils/pembimbingApi";

interface PembimbingScreenProps {
  onLogout: () => void;
}

/** Status LKH ringkas per mahasiswa untuk chip di dashboard. */
type LkhStatus = "approved" | "checked" | "pending" | "none";

interface StudentRow extends SupervisedStudent {
  lkhStatus?: LkhStatus;
}

// Data contoh untuk sesi DEMO pembimbing (token === DEMO_TOKEN) - dipakai agar
// sisi pembimbing bisa dilihat & didemokan TANPA akun dosen di server dev.
// Ditandai jelas sebagai contoh; tidak pernah dianggap data sungguhan.
const SAMPLE_STUDENTS: StudentRow[] = [
  { id: 1, kode: "60200122001", nama: "Andi Pratama", lkhStatus: "approved" },
  { id: 2, kode: "60200122002", nama: "Siti Nurhaliza", lkhStatus: "checked" },
  { id: 3, kode: "60200122003", nama: "Muh. Rizky", lkhStatus: "pending" },
  { id: 4, kode: "60200122004", nama: "Dewi Lestari", lkhStatus: "none" },
  { id: 5, kode: "60200122005", nama: "Ahmad Fauzan", lkhStatus: "pending" },
];

const STATUS_LABEL: Record<LkhStatus, string> = {
  approved: "Disetujui",
  checked: "Diperiksa",
  pending: "Belum diperiksa",
  none: "Belum mengisi",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PembimbingScreen({ onLogout }: PembimbingScreenProps) {
  const [nama, setNama] = useState("Memuat...");
  const [nip, setNip] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sekali saat mount - lihat catatan yang sama di LKHScreen/ProfileScreen.
  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileJson, token, savedNip] = await Promise.all([
        AsyncStorage.getItem("@user_profile"),
        AsyncStorage.getItem("@user_token"),
        AsyncStorage.getItem("@user_nim"),
      ]);

      if (profileJson) {
        const p = JSON.parse(profileJson);
        setNama(p.nama || "Pembimbing");
        setNip(p.nip || savedNip || "");
      } else {
        setNip(savedNip || "");
      }

      const demo = token === DEMO_TOKEN;
      setIsDemo(demo);

      if (demo) {
        // Data contoh - tidak menyentuh server.
        setStudents(SAMPLE_STUDENTS);
        return;
      }

      // Sesi asli: tarik daftar mahasiswa bimbingan dari server (dikunci NIP).
      const nipToUse = savedNip || "";
      if (!nipToUse || !token) {
        setError("Sesi tidak lengkap. Silakan login ulang.");
        return;
      }
      const list = await fetchSupervisedStudents(nipToUse, token);
      setStudents(Array.isArray(list) ? (list as StudentRow[]) : []);
    } catch (e) {
      console.error("Gagal memuat data pembimbing", e);
      // Status LKH per mahasiswa belum ditarik di fase ini (P3) - kegagalan di
      // sini berarti daftar bimbingan tak bisa diambil (server/sesi).
      setError(
        "Gagal mengambil daftar mahasiswa bimbingan dari server. Coba lagi.",
      );
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.glassShadow}>
          <BlurView intensity={45} tint="light" style={styles.headerCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(nama)}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.roleBadge}>PEMBIMBING</Text>
              <Text style={styles.name}>{nama}</Text>
              <Text style={styles.nip}>{nip ? `NIP ${nip}` : "-"}</Text>
            </View>
          </BlurView>
        </View>

        {isDemo && (
          <Text style={styles.demoNote}>
            Mode Demo Pembimbing - daftar mahasiswa di bawah adalah CONTOH,
            bukan data sungguhan.
          </Text>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Mahasiswa Bimbingan</Text>
          {!loading && (
            <Text style={styles.countPill}>{students.length}</Text>
          )}
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.centerText}>Memuat daftar bimbingan...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Ionicons name="cloud-offline-outline" size={32} color="#B4541E" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Coba Lagi</Text>
            </TouchableOpacity>
          </View>
        ) : students.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="people-outline" size={32} color="#8E8E93" />
            <Text style={styles.centerText}>
              Belum ada mahasiswa bimbingan.
            </Text>
          </View>
        ) : (
          <View style={styles.glassShadow}>
            <BlurView intensity={45} tint="light" style={styles.listCard}>
              {students.map((s, i) => (
                <View
                  key={s.id ?? s.kode ?? i}
                  style={[
                    styles.studentRow,
                    i < students.length - 1 && styles.studentRowDivider,
                  ]}
                >
                  <View style={styles.studentAvatar}>
                    <Text style={styles.studentAvatarText}>
                      {initials(s.nama || "?")}
                    </Text>
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {s.nama || "(tanpa nama)"}
                    </Text>
                    <Text style={styles.studentNim}>{s.kode || "-"}</Text>
                  </View>
                  <StatusChip status={s.lkhStatus} />
                </View>
              ))}
            </BlurView>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={confirmLogout}
        activeOpacity={0.85}
      >
        <Ionicons name="log-out-outline" size={20} color="#FFF" />
        <Text style={styles.logoutText}>LOGOUT</Text>
      </TouchableOpacity>

      <Text style={styles.versionText}>
        Versi {Constants.expoConfig?.version ?? "?"} (build{" "}
        {Constants.expoConfig?.ios?.buildNumber ?? "?"})
      </Text>
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status?: LkhStatus }) {
  // Tanpa status (sesi asli fase ini belum menarik LKH) - tampilkan netral.
  if (!status) {
    return (
      <View style={[styles.chip, styles.chipNeutral]}>
        <Text style={[styles.chipText, styles.chipNeutralText]}>LKH</Text>
      </View>
    );
  }
  const style =
    status === "approved"
      ? styles.chipApproved
      : status === "checked"
        ? styles.chipChecked
        : status === "pending"
          ? styles.chipPending
          : styles.chipNone;
  const textStyle =
    status === "approved"
      ? styles.chipApprovedText
      : status === "checked"
        ? styles.chipCheckedText
        : status === "pending"
          ? styles.chipPendingText
          : styles.chipNoneText;
  return (
    <View style={[styles.chip, style]}>
      <Text style={[styles.chipText, textStyle]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

const ACCENT = "#0E783D";
const TEXT_PRIMARY = "#1C1C1E";
const TEXT_SECONDARY = "#6E6E73";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EEF1F6" },
  scrollContent: { padding: 16, paddingBottom: 120 },
  glassShadow: {
    borderRadius: 24,
    marginBottom: 16,
    shadowColor: "#3A4B5C",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.45)",
    padding: 18,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarText: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  headerInfo: { flex: 1 },
  roleBadge: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    color: ACCENT,
    marginBottom: 2,
  },
  name: { fontSize: 18, fontWeight: "700", color: TEXT_PRIMARY },
  nip: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 2 },
  demoNote: {
    fontSize: 12.5,
    color: "#8A5A00",
    backgroundColor: "#FFF4DC",
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
    overflow: "hidden",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    flex: 1,
  },
  countPill: {
    fontSize: 13,
    fontWeight: "700",
    color: ACCENT,
    backgroundColor: "rgba(14,120,61,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  listCard: {
    backgroundColor: "rgba(255,255,255,0.45)",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
  },
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  studentRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(60,75,92,0.18)",
  },
  studentAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(14,120,61,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  studentAvatarText: { color: ACCENT, fontSize: 15, fontWeight: "700" },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: "600", color: TEXT_PRIMARY },
  studentNim: { fontSize: 12.5, color: TEXT_SECONDARY, marginTop: 1 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  chipApproved: { backgroundColor: "rgba(27,127,77,0.15)" },
  chipApprovedText: { color: "#1B7F4D" },
  chipChecked: { backgroundColor: "rgba(14,120,134,0.15)" },
  chipCheckedText: { color: "#0E7C86" },
  chipPending: { backgroundColor: "rgba(180,84,30,0.15)" },
  chipPendingText: { color: "#B4541E" },
  chipNone: { backgroundColor: "rgba(110,110,115,0.15)" },
  chipNoneText: { color: TEXT_SECONDARY },
  chipNeutral: { backgroundColor: "rgba(110,110,115,0.12)" },
  chipNeutralText: { color: TEXT_SECONDARY },
  centerBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  centerText: { color: TEXT_SECONDARY, fontSize: 14, textAlign: "center" },
  errorText: {
    color: "#B4541E",
    fontSize: 14,
    textAlign: "center",
    marginHorizontal: 8,
  },
  retryBtn: {
    marginTop: 6,
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
  },
  retryText: { color: "#FFF", fontWeight: "700" },
  logoutButton: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#C0392B",
    paddingVertical: 14,
    borderRadius: 26,
    shadowColor: "#C0392B",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  logoutText: { color: "#FFF", fontWeight: "800", letterSpacing: 0.5 },
  versionText: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#8E8E93",
    fontSize: 11,
  },
});
