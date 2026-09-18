import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { API_BASE, profilePhotoHeaders } from "../utils/api";
import { DEMO_TOKEN } from "../utils/demoMode";
import {
  approveLkh,
  checkLkh,
  fetchSupervisedLkh,
  fetchSupervisedStudents,
  type SupervisedStudent,
} from "../utils/pembimbingApi";

interface PembimbingScreenProps {
  onLogout: () => void;
}

/** Status LKH ringkas per mahasiswa (untuk chip). */
type LkhStatus = "approved" | "checked" | "pending" | "none";

/**
 * Detail LKH satu mahasiswa pada satu tanggal. Bentuknya mengikuti respons
 * /api/peserta-bimbing-lkh dari source Flutter resmi: tiap item punya
 * {id, kode, lkh}, dan lkh (null bila belum mengisi) berisi
 * {id, waktu, foto, deskripsi, program:{nama}, koordinat, checked, approved}.
 */
interface LkhDetail {
  hasLkh: boolean;
  lkhId?: string | number;
  waktu?: string;
  foto?: string;
  deskripsi?: string;
  programNama?: string;
  koordinat?: string;
  checked: boolean;
  approved: boolean;
}

interface StudentRow extends SupervisedStudent {
  lkhStatus?: LkhStatus;
}

interface DetailTarget {
  student: StudentRow;
  detail: LkhDetail;
}

// Data contoh untuk sesi DEMO pembimbing (token === DEMO_TOKEN).
const SAMPLE_STUDENTS: StudentRow[] = [
  { id: 1, kode: "60200122001", nama: "Andi Pratama" },
  { id: 2, kode: "60200122002", nama: "Siti Nurhaliza" },
  { id: 3, kode: "60200122003", nama: "Muh. Rizky" },
  { id: 4, kode: "60200122004", nama: "Dewi Lestari" },
  { id: 5, kode: "60200122005", nama: "Ahmad Fauzan" },
];

// LKH contoh (mode demo) sehingga alur tinjau/setujui bisa dicoba tanpa server.
function sampleLkhFor(kode: string, tanggal: string): LkhDetail | null {
  const seed: Record<string, Partial<LkhDetail>> = {
    "60200122001": { approved: true, checked: true },
    "60200122002": { checked: true },
    "60200122003": {},
    "60200122005": {},
  };
  const s = seed[kode];
  if (!s) return null; // 60200122004 = belum mengisi
  return {
    hasLkh: true,
    lkhId: `demo-${kode}`,
    waktu: tanggal,
    deskripsi:
      "Membantu mengajar di sekolah dasar dan menyiapkan program kerja posko.",
    programNama: "Program Kerja KKN",
    koordinat: "-5.2082,119.4797",
    checked: !!s.checked,
    approved: !!s.approved,
  };
}

const STATUS_LABEL: Record<LkhStatus, string> = {
  approved: "Disetujui",
  checked: "Diperiksa",
  pending: "Belum diperiksa",
  none: "Belum mengisi",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/** Ubah respons /api/peserta-bimbing-lkh menjadi peta kode(NIM) -> LkhDetail. */
function parseLkhList(list: unknown): Record<string, LkhDetail> {
  const map: Record<string, LkhDetail> = {};
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const kodeRaw = get(item, "kode");
    const kode = kodeRaw != null ? String(kodeRaw) : null;
    if (!kode) continue;
    const lkh = get(item, "lkh");
    if (lkh && typeof lkh === "object") {
      map[kode] = {
        hasLkh: true,
        lkhId: get(lkh, "id") as string | number | undefined,
        waktu: get(lkh, "waktu") as string | undefined,
        foto: get(lkh, "foto") as string | undefined,
        deskripsi: get(lkh, "deskripsi") as string | undefined,
        programNama: get(get(lkh, "program"), "nama") as string | undefined,
        koordinat: get(lkh, "koordinat") as string | undefined,
        checked: num(get(lkh, "checked")) === 1,
        approved: num(get(lkh, "approved")) === 1,
      };
    } else {
      map[kode] = { hasLkh: false, checked: false, approved: false };
    }
  }
  return map;
}

function statusOf(detail?: LkhDetail): LkhStatus {
  if (!detail || !detail.hasLkh) return "none";
  if (detail.approved) return "approved";
  if (detail.checked) return "checked";
  return "pending";
}

export default function PembimbingScreen({ onLogout }: PembimbingScreenProps) {
  const [nama, setNama] = useState("Memuat...");
  const [nip, setNip] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [lkhByKode, setLkhByKode] = useState<Record<string, LkhDetail>>({});
  const [lkhLoading, setLkhLoading] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [approving, setApproving] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const nipRef = useRef<string>("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      tokenRef.current = token;
      nipRef.current = savedNip || "";

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
        setStudents(SAMPLE_STUDENTS);
        loadLkhForDate(selectedDate, SAMPLE_STUDENTS, true);
        return;
      }

      if (!savedNip || !token) {
        setError("Sesi tidak lengkap. Silakan login ulang.");
        return;
      }
      const list = await fetchSupervisedStudents(savedNip, token);
      const roster = Array.isArray(list) ? (list as StudentRow[]) : [];
      setStudents(roster);
      loadLkhForDate(selectedDate, roster, false);
    } catch (e) {
      console.error("Gagal memuat data pembimbing", e);
      setError(
        "Gagal mengambil daftar mahasiswa bimbingan dari server. Coba lagi.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Ambil LKH seluruh mahasiswa untuk satu tanggal, lalu petakan kode->detail.
  const loadLkhForDate = useCallback(
    async (date: string, roster: StudentRow[], demo: boolean) => {
      setLkhLoading(true);
      try {
        if (demo) {
          const map: Record<string, LkhDetail> = {};
          for (const s of roster) {
            const d = sampleLkhFor(String(s.kode), date);
            if (d) map[String(s.kode)] = d;
            else map[String(s.kode)] = { hasLkh: false, checked: false, approved: false };
          }
          setLkhByKode(map);
          return;
        }
        const token = tokenRef.current;
        const nipToUse = nipRef.current;
        if (!token || !nipToUse) return;
        const raw = await fetchSupervisedLkh(nipToUse, date, token);
        setLkhByKode(parseLkhList(raw));
      } catch (e) {
        console.error("Gagal memuat LKH tanggal", date, e);
        // Kosongkan agar status jatuh ke "belum mengisi" alih-alih basi.
        setLkhByKode({});
      } finally {
        setLkhLoading(false);
      }
    },
    [],
  );

  const changeDate = (days: number) => {
    const next = shiftDate(selectedDate, days);
    setSelectedDate(next);
    loadLkhForDate(next, students, isDemo);
  };

  // Buka detail = otomatis tandai "diperiksa" (lkh-check), mengikuti app resmi.
  const openDetail = async (student: StudentRow) => {
    const d = lkhByKode[String(student.kode)];
    if (!d || !d.hasLkh) return;
    setDetail({ student, detail: d });

    if (!d.checked && d.lkhId != null) {
      // Tandai diperiksa di server + lokal.
      if (!isDemo && tokenRef.current) {
        try {
          await checkLkh(d.lkhId, tokenRef.current);
        } catch (e) {
          console.error("Gagal menandai LKH diperiksa", e);
        }
      }
      const updated = { ...d, checked: true };
      setLkhByKode((m) => ({ ...m, [String(student.kode)]: updated }));
      setDetail({ student, detail: updated });
    }
  };

  const toggleApprove = async (value: boolean) => {
    if (!detail) return;
    const d = detail.detail;
    if (d.lkhId == null) return;
    setApproving(true);
    try {
      if (!isDemo && tokenRef.current) {
        await approveLkh(d.lkhId, value ? 1 : 0, tokenRef.current);
      }
      const updated = { ...d, approved: value, checked: true };
      setDetail({ student: detail.student, detail: updated });
      setLkhByKode((m) => ({
        ...m,
        [String(detail.student.kode)]: updated,
      }));
    } catch (e) {
      Alert.alert(
        "Gagal",
        `Tidak dapat menyimpan persetujuan ke server.\n\n${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setApproving(false);
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

  const submittedCount = students.filter(
    (s) => lkhByKode[String(s.kode)]?.hasLkh,
  ).length;

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
            Mode Demo Pembimbing - data mahasiswa & LKH di bawah adalah CONTOH.
          </Text>
        )}

        {/* Pemilih tanggal - dashboard dosen berbasis tanggal (seperti app resmi) */}
        <View style={styles.dateBar}>
          <TouchableOpacity
            onPress={() => changeDate(-1)}
            style={styles.dateArrow}
          >
            <Ionicons name="chevron-back" size={20} color={ACCENT} />
          </TouchableOpacity>
          <View style={styles.dateCenter}>
            <Text style={styles.dateText}>{prettyDate(selectedDate)}</Text>
            <Text style={styles.dateSub}>
              {lkhLoading
                ? "memuat..."
                : `${submittedCount} dari ${students.length} mengisi`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => changeDate(1)}
            style={styles.dateArrow}
          >
            <Ionicons name="chevron-forward" size={20} color={ACCENT} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Mahasiswa Bimbingan</Text>
          {!loading && <Text style={styles.countPill}>{students.length}</Text>}
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
              {students.map((s, i) => {
                const d = lkhByKode[String(s.kode)];
                const status = statusOf(d);
                const tappable = !!d?.hasLkh;
                return (
                  <TouchableOpacity
                    key={s.id ?? s.kode ?? i}
                    activeOpacity={tappable ? 0.6 : 1}
                    onPress={() => tappable && openDetail(s)}
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
                    <StatusChip status={status} />
                    {tappable && (
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="#B8C0CA"
                        style={{ marginLeft: 4 }}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </BlurView>
          </View>
        )}
      </ScrollView>

      {/* Detail LKH + tinjau/setujui */}
      <Modal
        visible={!!detail}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {detail && (
              <ScrollView>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalName}>
                      {detail.student.nama || "(tanpa nama)"}
                    </Text>
                    <Text style={styles.modalNim}>
                      {detail.student.kode} · {prettyDate(selectedDate)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setDetail(null)}>
                    <Ionicons name="close-circle" size={28} color="#B8C0CA" />
                  </TouchableOpacity>
                </View>

                {detail.detail.foto ? (
                  <Image
                    source={{
                      uri: `${API_BASE}/uploads/${detail.detail.foto}`,
                      headers: profilePhotoHeaders(tokenRef.current || ""),
                    }}
                    style={styles.modalPhoto}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.modalPhoto, styles.modalPhotoEmpty]}>
                    <Ionicons name="image-outline" size={32} color="#B8C0CA" />
                    <Text style={styles.centerText}>Tanpa foto</Text>
                  </View>
                )}

                {!!detail.detail.programNama && (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Program</Text>
                    <Text style={styles.fieldValue}>
                      {detail.detail.programNama}
                    </Text>
                  </View>
                )}
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Deskripsi kegiatan</Text>
                  <Text style={styles.fieldValue}>
                    {detail.detail.deskripsi || "(tidak ada deskripsi)"}
                  </Text>
                </View>
                {!!detail.detail.koordinat && (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Koordinat</Text>
                    <Text style={styles.fieldValue}>
                      {detail.detail.koordinat}
                    </Text>
                  </View>
                )}

                <View style={styles.approveRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.approveLabel}>Setujui LKH ini</Text>
                    <Text style={styles.approveHint}>
                      {detail.detail.approved
                        ? "Sudah disetujui"
                        : detail.detail.checked
                          ? "Sudah diperiksa, belum disetujui"
                          : "Belum diperiksa"}
                    </Text>
                  </View>
                  {approving ? (
                    <ActivityIndicator color={ACCENT} />
                  ) : (
                    <Switch
                      value={detail.detail.approved}
                      onValueChange={toggleApprove}
                      trackColor={{ false: "#CFD6DD", true: "#8FD3AE" }}
                      thumbColor={detail.detail.approved ? ACCENT : "#F4F4F4"}
                    />
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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

function StatusChip({ status }: { status: LkhStatus }) {
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
  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E4E9EF",
  },
  dateArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14,120,61,0.10)",
  },
  dateCenter: { flex: 1, alignItems: "center" },
  dateText: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY },
  dateSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#F7F9FB",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    maxHeight: "88%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  modalName: { fontSize: 18, fontWeight: "800", color: TEXT_PRIMARY },
  modalNim: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 2 },
  modalPhoto: {
    width: "100%",
    aspectRatio: 3 / 4,
    maxHeight: 340,
    borderRadius: 16,
    backgroundColor: "#E4E9EF",
    marginBottom: 16,
  },
  modalPhotoEmpty: { alignItems: "center", justifyContent: "center", gap: 6 },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: TEXT_SECONDARY,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  fieldValue: { fontSize: 15, color: TEXT_PRIMARY, lineHeight: 21 },
  approveRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E4E9EF",
  },
  approveLabel: { fontSize: 15, fontWeight: "700", color: TEXT_PRIMARY },
  approveHint: { fontSize: 12.5, color: TEXT_SECONDARY, marginTop: 2 },
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
