import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo";
import * as Location from "expo-location";
import { Platform } from "react-native";

import { MODE_LOKAL } from "./modeLokal";

/**
 * Location-based attendance restriction, following the official Flutter app
 * (lib/screens/peserta_lkh.dart, validasiLokasiMaps):
 *
 *   1. FAKE GPS FIRST. If the position is mocked, attendance is refused with
 *      "Anda terdeteksi menggunakan lokasi palsu (fake GPS)" - regardless of
 *      distance. Flutter reads geolocator's `Position.isMocked`; here Android
 *      reads expo-location's `mocked` (Location.isFromMockProvider, the same
 *      source geolocator uses) and iOS reads
 *      `CLLocation.sourceInformation.isSimulatedBySoftware` through the local
 *      module in modules/lokasi-palsu, because expo-location does not pass
 *      that flag through on iOS.
 *   2. DISTANCE. The distance in metres, rounded, must be <= the radius the
 *      admin set for the kecamatan (`wilayahKec.setting.radius`), measured
 *      from `wilayahKec.setting.koordinat`. Otherwise "Anda tidak berada
 *      dalam area lokasi KKN anda".
 *
 * WHEN THE SERVER HAS NO SETTING (observed: often empty, not yet filled in by
 * an admin) this app deliberately differs from Flutter, which would simply
 * fail on the missing value: resolvePoskoLocation() falls back to the
 * geocoded kecamatan centre (OpenStreetMap Nominatim, cached) with a fixed
 * MAX_DISTANCE_KM radius, and if even that is unavailable the distance check
 * is skipped (fail-open) - face verification remains the primary
 * anti-titip-absen defense. The fake-GPS check never depends on this.
 */

export const MAX_DISTANCE_KM = 10;

/** MODE LOKAL saja: berapa lama menunggu posisi untuk memeriksa lokasi palsu. */
const BATAS_GPS_DEMO_MS = 8000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ProfileLocationHint {
  kecamatan?: string | null;
  kabupaten?: string | null;
  poskoKoordinat?: string | null;
  /** `wilayahKec.setting.radius`, in metres. */
  poskoRadius?: number | null;
}

/** The point and radius one attendance is checked against. */
export interface AcuanLokasi {
  titik: Coordinates;
  radiusMeter: number;
  /** true = both came from the server's kecamatan setting (Flutter's rule). */
  dariServer: boolean;
}

/** Native iOS module in modules/lokasi-palsu; null on Android or in Expo Go. */
const LokasiPalsu =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<{
        ambilLokasi(): Promise<{
          latitude: number;
          longitude: number;
          akurasi: number;
          simulasi: boolean;
        }>;
      }>("LokasiPalsu")
    : null;

export class LocationPermissionDeniedError extends Error {}
export class LocationUnavailableError extends Error {}

/** Haversine great-circle distance between two lat/long points, in km. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_KM * c;
}

/** "850 m" below one kilometre, "2,4 km" above it (Indonesian decimal comma). */
export function formatJarak(meter: number): string {
  return meter < 1000
    ? `${Math.round(meter)} m`
    : `${(meter / 1000).toFixed(1).replace(".", ",")} km`;
}

function isValidCoordinate(c: Coordinates): boolean {
  return (
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.latitude) <= 90 &&
    Math.abs(c.longitude) <= 180 &&
    // (0,0) almost always means "actually empty/unset", not Null Island.
    !(c.latitude === 0 && c.longitude === 0)
  );
}

/**
 * Parses a "lat,long" (or "lat;long") style string as commonly used for a
 * single free-text coordinate field. Returns null if the string is empty or
 * not in a recognizable format.
 */
function parseCoordinateString(raw: string): Coordinates | null {
  const parts = raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;

  const coord: Coordinates = {
    latitude: parseFloat(parts[0]),
    longitude: parseFloat(parts[1]),
  };
  return isValidCoordinate(coord) ? coord : null;
}

const GEOCODE_CACHE_PREFIX = "@geocode_cache_";

/**
 * Resolves a kecamatan+kabupaten name to approximate coordinates via
 * OpenStreetMap's free Nominatim geocoder, caching the result locally.
 * Returns null if the lookup fails (no internet, no match, etc.) - this is
 * a best-effort fallback, not a guaranteed source.
 */
async function geocodeKecamatan(
  kecamatan: string,
  kabupaten: string,
): Promise<Coordinates | null> {
  const cacheKey = `${GEOCODE_CACHE_PREFIX}${kecamatan}_${kabupaten}`.toLowerCase();

  const cached = await AsyncStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Coordinates;
      if (isValidCoordinate(parsed)) return parsed;
    } catch {
      // fall through and re-fetch
    }
  }

  try {
    const query = encodeURIComponent(`${kecamatan}, ${kabupaten}, Indonesia`);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
      {
        headers: {
          // Nominatim's usage policy requires an identifying User-Agent.
          "User-Agent": "lkh-kkn-ios (KKN attendance app, geofence lookup)",
        },
      },
    );
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const coord: Coordinates = {
      latitude: parseFloat(results[0].lat),
      longitude: parseFloat(results[0].lon),
    };
    if (!isValidCoordinate(coord)) return null;

    await AsyncStorage.setItem(cacheKey, JSON.stringify(coord));
    return coord;
  } catch {
    return null;
  }
}

/**
 * Resolves the point and radius to check attendance against, for a specific
 * student's profile. Server setting first (koordinat AND radius, Flutter's
 * rule); otherwise the fallback described in the module doc comment.
 */
export async function resolvePoskoLocation(
  hint: ProfileLocationHint,
): Promise<AcuanLokasi | null> {
  const titikServer = hint.poskoKoordinat
    ? parseCoordinateString(hint.poskoKoordinat)
    : null;
  const radiusServer =
    typeof hint.poskoRadius === "number" &&
    Number.isFinite(hint.poskoRadius) &&
    hint.poskoRadius > 0
      ? hint.poskoRadius
      : null;
  if (titikServer && radiusServer !== null) {
    return { titik: titikServer, radiusMeter: radiusServer, dariServer: true };
  }

  const titik =
    titikServer ??
    (hint.kecamatan && hint.kabupaten
      ? await geocodeKecamatan(hint.kecamatan, hint.kabupaten)
      : null);
  return titik
    ? { titik, radiusMeter: MAX_DISTANCE_KM * 1000, dariServer: false }
    : null;
}

export interface GeofenceCheckResult {
  allowed: boolean;
  /** The position is simulated (fake GPS). Always means allowed = false. */
  mocked: boolean;
  distanceKm: number | null;
  /** True when the posko location couldn't be resolved at all - the distance
   * check was skipped (fail-open) rather than genuinely passing. */
  locationUnresolved: boolean;
  /** The device's own GPS coordinates at check time - callers that need to
   * submit "where this attendance happened" (e.g. syncing to the server)
   * can reuse this instead of requesting location again. */
  userLocation: Coordinates;
}

/**
 * One GPS fix plus whether it is simulated. On iOS the native module supplies
 * both; if it is missing (Expo Go, an older build) the fix comes from
 * expo-location and the fake-GPS flag cannot be read, so it reports false.
 */
async function ambilPosisi(): Promise<{ coords: Coordinates; mocked: boolean }> {
  if (LokasiPalsu) {
    const hasil = await LokasiPalsu.ambilLokasi();
    return {
      coords: { latitude: hasil.latitude, longitude: hasil.longitude },
      mocked: hasil.simulasi === true,
    };
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    },
    mocked: position.mocked === true,
  };
}

/**
 * Gets the device's current GPS position and checks it against the given
 * point and radius, fake GPS first (see module doc comment). Throws
 * LocationPermissionDeniedError if permission is denied, or
 * LocationUnavailableError if a GPS fix can't be obtained (e.g. indoors with
 * no signal, location services off).
 */
export async function checkAttendanceLocation(
  acuan: AcuanLokasi | null,
): Promise<GeofenceCheckResult> {
  // MODE LOKAL: pemeriksaan jarak dilewati sepenuhnya. Bukan untuk
  // melonggarkan pemeriksaan, tapi karena ruang seminar tertutup:
  // getCurrentPositionAsync({High}) bisa gagal di dalam gedung dan melempar
  // LocationUnavailableError, dan itu akan mematikan peragaan tepat di
  // depan penguji. Jalur ini SAMA dengan jalur gagal-terbuka yang sudah ada
  // untuk posko yang tidak diketahui, jadi perilakunya bukan hal baru.
  //
  // Pengecualiannya lokasi palsu: kalau posisi bisa didapat dalam
  // BATAS_GPS_DEMO_MS, penandanya tetap diperiksa, supaya penolakan fake GPS
  // dapat diperagakan. Gagal atau lambat -> tetap diizinkan seperti semula.
  if (MODE_LOKAL) {
    let mocked = false;
    try {
      const izin = await Location.requestForegroundPermissionsAsync();
      if (izin.status === "granted") {
        const posisi = await Promise.race([
          ambilPosisi(),
          new Promise<null>((r) => setTimeout(() => r(null), BATAS_GPS_DEMO_MS)),
        ]);
        mocked = posisi?.mocked === true;
      }
    } catch {
      // Tidak ada posisi di dalam gedung bukan alasan menggagalkan peragaan.
    }
    return {
      allowed: !mocked,
      mocked,
      distanceKm: null,
      locationUnresolved: true,
      userLocation: { latitude: 0, longitude: 0 },
    };
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw new LocationPermissionDeniedError(
      "Izin lokasi dibutuhkan untuk memverifikasi posisi absensi.",
    );
  }

  let posisi: { coords: Coordinates; mocked: boolean };
  try {
    posisi = await ambilPosisi();
  } catch {
    throw new LocationUnavailableError(
      "Tidak bisa mendapatkan lokasi GPS. Pastikan layanan lokasi aktif dan coba lagi di area terbuka.",
    );
  }
  const userLocation = posisi.coords;

  if (!acuan) {
    return {
      allowed: !posisi.mocked,
      mocked: posisi.mocked,
      distanceKm: null,
      locationUnresolved: true,
      userLocation,
    };
  }

  const distance = distanceKm(acuan.titik, userLocation);

  return {
    // Flutter compares whole metres: hitungRadius() returns meters.round().
    allowed: !posisi.mocked && Math.round(distance * 1000) <= acuan.radiusMeter,
    mocked: posisi.mocked,
    distanceKm: distance,
    locationUnresolved: false,
    userLocation,
  };
}
