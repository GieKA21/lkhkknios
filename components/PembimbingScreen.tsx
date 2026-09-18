import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { profilePhotoHeaders, profilePhotoUrl } from "../utils/api";
import { DEMO_TOKEN } from "../utils/demoMode";
import {
  fetchPembimbingDates,
  fetchSupervisedLkh,
  fetchSupervisedStudents,
} from "../utils/pembimbingApi";

interface PembimbingScreenProps {
  onLogout: () => void;
}

/** Satu mahasiswa bimbingan (dari /api/peserta-bimbing). */
interface Student {
  id?: string | number;
  kode: string; // NIM
  nama: string;
  foto?: string;
  prodi?: string;
  kecamatan?: string;
}

/** Ringkasan kehadiran satu tanggal (dari /api/pembimbing-tanggal). */
type DayFill = "all" | "some" | "none";

// Data contoh untuk sesi DEMO pembimbing.
const SAMPLE_STUDENTS: Student[] = [
  { id: 1, kode: "60200122001", nama: "Andi Pratama", prodi: "Teknik Informatika", kecamatan: "Kec. Somba Opu" },
  { id: 2, kode: "60200122002", nama: "Siti Nurhaliza", prodi: "Ilmu Hukum", kecamatan: "Kec. Somba Opu" },
  { id: 3, kode: "60200122003", nama: "Muh. Rizky", prodi: "Hukum Keluarga", kecamatan: "Kec. Somba Opu" },
  { id: 4, kode: "60200122004", nama: "Dewi Lestari", prodi: "Ilmu Hukum", kecamatan: "Kec. Somba Opu" },
  { id: 5, kode: "60200122005", nama: "Ahmad Fauzan", prodi: "Teknik Informatika", kecamatan: "Kec. Somba Opu" },
];

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return `${days[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}
function num(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
}

/** Parse /api/peserta-bimbing menjadi daftar mahasiswa dengan detailnya. */
function parseRoster(list: unknown): Student[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((it): Student | null => {
      const kode = get(it, "kode");
      if (kode == null) return null;
      return {
        id: get(it, "id") as string | number | undefined,
        kode: String(kode),
        nama: (get(it, "nama") as string) || "(tanpa nama)",
        foto: get(it, "foto") as string | undefined,
        prodi: get(get(it, "prodi"), "nama") as string | undefined,
        kecamatan: get(get(it, "wilayahKec"), "nama") as string | undefined,
      };
    })
    .filter((s): s is Student => s !== null);
}

/** Parse /api/peserta-bimbing-lkh menjadi peta kode(NIM) -> mengisi?(boolean). */
function parseHadir(list: unknown): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const kode = get(item, "kode");
    if (kode == null) continue;
    map[String(kode)] = get(item, "lkh") != null;
  }
  return map;
}

/** Parse /api/pembimbing-tanggal menjadi peta tanggal -> tingkat kehadiran. */
function parseDays(list: unknown): Record<string, DayFill> {
  const map: Record<string, DayFill> = {};
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const waktu = get(item, "waktu");
    if (waktu == null) continue;
    const key = String(waktu).slice(0, 10);
    const filled = num(get(item, "checked"));
    const total = num(get(item, "total"));
    map[key] =
      total > 0 && filled >= total ? "all" : filled > 0 ? "some" : "none";
  }
  return map;
}

export default function PembimbingScreen({ onLogout }: PembimbingScreenProps) {
  const [nama, setNama] = useState("Memuat...");
  const [nip, setNip] = useState("");
  const [prodi, setProdi] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [dayFill, setDayFill] = useState<Record<string, DayFill>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Modal per-tanggal
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [hadir, setHadir] = useState<Record<string, boolean>>({});
  const [hadirLoading, setHadirLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyAbsent, setOnlyAbsent] = useState(false);

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
      const [profileJson, token, savedNip, savedId] = await Promise.all([
        AsyncStorage.getItem("@user_profile"),
        AsyncStorage.getItem("@user_token"),
        AsyncStorage.getItem("@user_nim"),
        AsyncStorage.getItem("@user_id"),
      ]);
      tokenRef.current = token;
      nipRef.current = savedNip || "";

      if (profileJson) {
        const p = JSON.parse(profileJson);
        setNama(p.nama || "Pembimbing");
        setNip(p.nip || savedNip || "");
        setProdi(p.prodi || "");
      }

      const demo = token === DEMO_TOKEN;
      setIsDemo(demo);

      if (demo) {
        setStudents(SAMPLE_STUDENTS);
        setDayFill({ [dateKey(now.getFullYear(), now.getMonth(), 18)]: "some" });
        return;
      }
      if (!savedNip || !token) {
        setError("Sesi tidak lengkap. Silakan login ulang.");
        return;
      }

      const [roster, dates] = await Promise.all([
        fetchSupervisedStudents(savedNip, token),
        savedId ? fetchPembimbingDates(savedId, token) : Promise.resolve([]),
      ]);
      setStudents(parseRoster(roster));
      setDayFill(parseDays(dates));
    } catch (e) {
      console.error("Gagal memuat data pembimbing", e);
      setError("Gagal mengambil data bimbingan dari server. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const openDate = useCallback(
    async (date: string) => {
      setModalDate(date);
      setSearch("");
      setOnlyAbsent(false);
      setHadir({});
      if (isDemo) {
        // Contoh: sebagian hadir.
        setHadir({
          "60200122001": true,
          "60200122002": true,
          "60200122005": true,
        });
        return;
      }
      const token = tokenRef.current;
      const nipToUse = nipRef.current;
      if (!token || !nipToUse) return;
      setHadirLoading(true);
      try {
        const raw = await fetchSupervisedLkh(nipToUse, date, token);
        setHadir(parseHadir(raw));
      } catch (e) {
        console.error("Gagal memuat kehadiran tanggal", date, e);
        setHadir({});
      } finally {
        setHadirLoading(false);
      }
    },
    [isDemo],
  );

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

  // ---- Kalender ----
  const calendarCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const changeMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  // ---- Daftar mahasiswa terfilter (modal) ----
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (onlyAbsent && hadir[s.kode]) return false;
      if (!q) return true;
      return (
        s.nama.toLowerCase().includes(q) ||
        s.kode.toLowerCase().includes(q) ||
        (s.prodi || "").toLowerCase().includes(q) ||
        (s.kecamatan || "").toLowerCase().includes(q)
      );
    });
  }, [students, hadir, search, onlyAbsent]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.glassShadow}>
          <BlurView intensity={45} tint="light" style={styles.headerCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(nama)}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.roleBadge}>DOSEN PEMBIMBING</Text>
              <Text style={styles.name}>{nama}</Text>
              <Text style={styles.nip}>{nip ? `NIP ${nip}` : "-"}</Text>
              {!!prodi && <Text style={styles.nip}>{prodi}</Text>}
            </View>
          </BlurView>
        </View>

        {isDemo && (
          <Text style={styles.demoNote}>
            Mode Demo Pembimbing - data di bawah adalah CONTOH.
          </Text>
        )}

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.centerText}>Memuat data bimbingan...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Ionicons name="cloud-offline-outline" size={32} color="#B4541E" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Coba Lagi</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Kalender kehadiran */}
            <View style={styles.calendarCard}>
              <View style={styles.calHeader}>
                <TouchableOpacity
                  onPress={() => changeMonth(-1)}
                  style={styles.dateArrow}
                >
                  <Ionicons name="chevron-back" size={20} color={ACCENT} />
                </TouchableOpacity>
                <Text style={styles.calTitle}>
                  {MONTHS[viewMonth]} {viewYear}
                </Text>
                <TouchableOpacity
                  onPress={() => changeMonth(1)}
                  style={styles.dateArrow}
                >
                  <Ionicons name="chevron-forward" size={20} color={ACCENT} />
                </TouchableOpacity>
              </View>

              <View style={styles.weekRow}>
                {WEEKDAYS.map((w, i) => (
                  <Text
                    key={w}
                    style={[
                      styles.weekday,
                      (i === 0 || i === 6) && styles.weekdayEnd,
                    ]}
                  >
                    {w}
                  </Text>
                ))}
              </View>

              <View style={styles.grid}>
                {calendarCells.map((d, i) => {
                  if (d === null)
                    return <View key={`e${i}`} style={styles.cell} />;
                  const key = dateKey(viewYear, viewMonth, d);
                  const fill = dayFill[key];
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.cell}
                      activeOpacity={fill ? 0.6 : 1}
                      onPress={() => fill && openDate(key)}
                    >
                      <View
                        style={[
                          styles.dayDot,
                          fill === "all" && styles.dayAll,
                          fill === "some" && styles.daySome,
                          fill === "none" && styles.dayNone,
                        ]}
                      >
                        <Text style={styles.dayText}>{d}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.legend}>
                <Legend color="#99B9F7" label="Hadir semua" />
                <Legend color="#F5D95E" label="Sebagian" />
                <Legend color="#F7CCCE" label="Tidak ada" />
              </View>
            </View>

            <Text style={styles.hintText}>
              Ketuk tanggal berwarna untuk melihat kehadiran mahasiswa hari itu.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Modal daftar kehadiran per tanggal */}
      <Modal
        visible={!!modalDate}
        animationType="slide"
        transparent
        onRequestClose={() => setModalDate(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalDate ? prettyDate(modalDate) : ""}
            </Text>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color="#8E8E93" />
              <TextInput
                style={styles.searchInput}
                placeholder="Cari nama, NIM, prodi, kecamatan"
                placeholderTextColor="#9AA3AD"
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>
                Tampilkan hanya yang tidak mengisi
              </Text>
              <Switch
                value={onlyAbsent}
                onValueChange={setOnlyAbsent}
                trackColor={{ false: "#CFD6DD", true: "#E9A8AB" }}
                thumbColor={onlyAbsent ? "#C0392B" : "#F4F4F4"}
              />
            </View>
            <Text style={styles.totalText}>
              {hadirLoading
                ? "Memuat kehadiran..."
                : `Total tampil: ${filteredStudents.length}`}
            </Text>

            <ScrollView style={{ marginTop: 8 }}>
              {filteredStudents.map((s, i) => {
                const isHadir = !!hadir[s.kode];
                return (
                  <View
                    key={s.id ?? s.kode ?? i}
                    style={[
                      styles.studentCard,
                      isHadir ? styles.cardHadir : styles.cardAbsent,
                    ]}
                  >
                    {s.foto ? (
                      <Image
                        source={{
                          uri: profilePhotoUrl(s.foto),
                          headers: profilePhotoHeaders(tokenRef.current || ""),
                        }}
                        style={styles.cardPhoto}
                      />
                    ) : (
                      <View style={[styles.cardPhoto, styles.cardPhotoEmpty]}>
                        <Text style={styles.studentAvatarText}>
                          {initials(s.nama)}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {s.nama}
                      </Text>
                      <Text style={styles.cardMeta}>NIM: {s.kode}</Text>
                      {!!s.prodi && (
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {s.prodi}
                        </Text>
                      )}
                      {!!s.kecamatan && (
                        <Text style={styles.cardMeta}>{s.kecamatan}</Text>
                      )}
                      <View
                        style={[
                          styles.badge,
                          isHadir ? styles.badgeHadir : styles.badgeAbsent,
                        ]}
                      >
                        <Ionicons
                          name={isHadir ? "checkmark-circle" : "close-circle"}
                          size={14}
                          color={isHadir ? "#1B7F4D" : "#C0392B"}
                        />
                        <Text
                          style={[
                            styles.badgeText,
                            { color: isHadir ? "#1B7F4D" : "#C0392B" },
                          ]}
                        >
                          {isHadir ? "Hadir" : "Tidak mengisi"}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
              <View style={{ height: 8 }} />
            </ScrollView>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setModalDate(null)}
            >
              <Text style={styles.closeText}>Tutup</Text>
            </TouchableOpacity>
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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
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
  calendarCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E4E9EF",
  },
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  calTitle: { fontSize: 16, fontWeight: "800", color: ACCENT },
  dateArrow: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14,120,61,0.10)",
  },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: TEXT_SECONDARY,
  },
  weekdayEnd: { color: "#C0392B" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
  },
  dayDot: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    maxWidth: 44,
    maxHeight: 44,
  },
  dayAll: { backgroundColor: "#99B9F7" },
  daySome: { backgroundColor: "#F5D95E" },
  dayNone: { backgroundColor: "#F7CCCE" },
  dayText: { fontSize: 14, fontWeight: "600", color: "#1C1C1E" },
  legend: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E4E9EF",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 7 },
  legendText: { fontSize: 12, color: TEXT_SECONDARY },
  hintText: {
    fontSize: 12.5,
    color: TEXT_SECONDARY,
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 12,
  },
  centerBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
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
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#F2ECF0",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 18,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_PRIMARY,
    textAlign: "center",
    marginBottom: 14,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E4E9EF",
  },
  searchInput: { flex: 1, fontSize: 14, color: TEXT_PRIMARY, padding: 0 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  filterLabel: { flex: 1, fontSize: 13.5, color: TEXT_PRIMARY },
  totalText: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 8 },
  studentCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    borderWidth: 1.5,
  },
  cardHadir: { borderColor: "rgba(27,127,77,0.35)", backgroundColor: "#F1FAF4" },
  cardAbsent: { borderColor: "rgba(192,57,43,0.30)", backgroundColor: "#FDF2F2" },
  cardPhoto: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#E4E9EF" },
  cardPhotoEmpty: { alignItems: "center", justifyContent: "center" },
  studentAvatarText: { color: ACCENT, fontSize: 17, fontWeight: "700" },
  cardName: { fontSize: 15.5, fontWeight: "800", color: TEXT_PRIMARY },
  cardMeta: { fontSize: 12.5, color: TEXT_SECONDARY, marginTop: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeHadir: { backgroundColor: "rgba(27,127,77,0.12)" },
  badgeAbsent: { backgroundColor: "rgba(192,57,43,0.12)" },
  badgeText: { fontSize: 12.5, fontWeight: "700" },
  closeBtn: {
    backgroundColor: "#C0392B",
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 12,
  },
  closeText: { color: "#FFF", fontWeight: "800", letterSpacing: 0.5 },
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
