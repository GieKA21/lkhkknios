import * as Device from "expo-device";

/**
 * Version string sent to every LKH API call (`version=...`). Centralized so
 * a server-side minimum-version gate can be answered from ONE place - the
 * official Flutter app's own version string is the value most likely to be
 * accepted (see LoginScreen/LKHScreen usage).
 *
 * THIS IS NOT THE APP'S VERSION. It is a protocol constant that has to keep
 * matching whatever the official Android app sends, so it must NOT be bumped
 * per release or per build - raising it risks the server rejecting us. The
 * app's own version lives in app.json (expo.version + ios.buildNumber, the
 * latter stamped per CI run) and is what the Login and Profile screens show.
 * The two only happen to share the word "version".
 */
export const APP_VERSION = "1.1.1";

/**
 * User-Agent yang sesuai dengan klien resmi. WAF di depan server hanya
 * meneruskan request dengan User-Agent Dart; tanpa header ini request tidak
 * sampai ke backend (mengembalikan halaman HTML). Setiap request - fetch()
 * maupun sumber <Image> - harus mengirim header ini.
 */
export const API_USER_AGENT = "Dart/3.8 (dart:io)";

/**
 * `device_info` payload the server records for each request. The server's
 * request format uses the field names of Android's Build class, so the shape
 * below keeps those keys; the VALUES are read from the ACTUAL device via
 * expo-device, so each phone reports its own real model (e.g. an iPhone XR
 * reports "iPhone XR"), instead of one shared fixed value.
 *
 * A couple of keys have no direct iOS equivalent and are filled with the
 * closest sensible value: `version.sdkInt` takes the numeric iOS major
 * version, `hardware` is left generic. If the server turns out to require
 * specific values, the previous fixed fingerprint is recoverable from git
 * history.
 */
function buildDeviceInfo() {
  const os = Device.osVersion ?? ""; // e.g. "18.0"
  const majorNum = parseInt(os, 10);
  return {
    "version.sdkInt": Number.isFinite(majorNum) ? majorNum : 0,
    "version.release": os,
    "version.codename": "REL",
    "version.baseOS": "",
    brand: Device.brand ?? "Apple",
    device: Device.modelId ?? Device.modelName ?? "",
    display: Device.osBuildId ?? "",
    hardware: "apple",
    id: Device.osBuildId ?? "",
    manufacturer: Device.manufacturer ?? "Apple",
    model: Device.modelName ?? "",
    product: Device.modelId ?? Device.modelName ?? "",
    type: "user",
    isPhysicalDevice: Device.isDevice,
    serialNumber: "unknown",
    isLowRamDevice: false,
  };
}

// Dibangun sekali saat modul dimuat - nilai expo-device bersifat konstan
// per perangkat, jadi tidak perlu dihitung ulang tiap panggilan.
const DEVICE_INFO = buildDeviceInfo();

export function getDeviceInfoObject() {
  return DEVICE_INFO;
}

/** URL-encoded JSON string, for use directly in a query string. */
export function getDeviceInfoStr(): string {
  return encodeURIComponent(JSON.stringify(DEVICE_INFO));
}
