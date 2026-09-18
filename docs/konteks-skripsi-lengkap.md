# Konteks Lengkap Skripsi — Presensi Face Verification + Intelligent Agent

> **Berkas ini adalah EKSPOR konteks** dari sesi kerja Claude Code di repo
> `lkh-kkn-ios`. Unggah/tempel ke Claude chat untuk melanjutkan pengerjaan
> skripsi tanpa mengulang penjelasan dari nol.
>
> Isinya: (1) memori proyek, (2) dokumen agen cerdas, (3) hasil kalibrasi
> beserta angka-angka pengujian.

## Ringkas: di mana posisi pekerjaan saat ini

- **Judul (revisi dosen):** "Pengembangan Presensi Berbasis Face Verification
  dan Intelligent Agent pada Aplikasi KKN Cross-Platform Menggunakan React
  Native."
- **Status:** prototipe **iOS** berjalan (login, LKH, pendaftaran wajah,
  verifikasi wajah, liveness, sisi pembimbing fase 1–2). Android **belum**
  dibangun — rencananya dari kodebase React Native yang sama.
- **Yang sudah terbukti di perangkat:** wajah orang lain ditolak (skor 0.34
  vs ambang 0.47). Yang **belum** terbukti: pemilik asli diterima setelah
  daftar ulang di aplikasi ini; sisi pembimbing dengan akun asli.
- **Blocker:** belum ada akun pembimbing di server untuk uji sisi dosen.

## Daftar isi

1. Memori proyek (10 berkas)
2. Dokumen Intelligent Agent (PEAS, tipe agen, pemetaan kode)
3. Hasil kalibrasi & metode pengujian (angka untuk bab evaluasi)

---

# BAGIAN 1 — MEMORI PROYEK

## [memori] MEMORY.md

```markdown
- [LKH KKN app overview](lkh-kkn-app-overview.md) — what the app is, and why every iOS build has to go through a GitHub Actions macOS runner.
- [Face verification pipeline](face-verification-pipeline.md) — how enrollment/verify are wired across four files, and the invariant refactors keep breaking.
- [Face mismatch open issue](face-mismatch-open-issue.md) — a stranger's face can still pass; max-of-N inflated the scores and 0.6 is only a guess.
- [LKH server API constraints](lkh-server-api-constraints.md) — Dart User-Agent or Cloudflare blocks you, plus why demo mode exists.
- [User: skripsi student](user-skripsi-student.md) — Indonesian-language project, Windows-only, thesis provenance notes matter.
- [Android app reverse engineering](android-app-reverse-engineering.md) — the APK's full API map, server-side face storage, and the model that needed no conversion.
- [Face calibration results](face-calibration-results.md) — what the offline sweep measured, the constants it set, and why crop/aggregation/threshold must move together.
- [Thesis direction: agent + cross-platform](thesis-direction-agent-crossplatform.md) — revised title, the AI-agent-in-face-recognition requirement, and the iOS-first → Android roadmap.
- [LKH Flutter source API](lkh-flutter-source-api.md) — authoritative endpoints/fields from the supervisor's real Flutter source; corrects nim→id, dev vs prod server, and the flawed box-crop pipeline.
```

## [memori] user-skripsi-student.md

```markdown
---
name: user-skripsi-student
description: Who the user is on this project and the language/communication defaults they work in.
metadata:
  type: user
---

The user is an undergraduate student building `lkh-kkn-ios` as their
skripsi (thesis) project — the repo lives under a `Skripsi/` folder. They
work on Windows, in VS Code, with no Mac available.

They write requests in Indonesian and the codebase follows suit: all
user-facing strings (alerts, button labels, guidance text) are Indonesian,
and newer code comments are written in Indonesian too, while the older
`utils/` module doc comments are in English. Match the surrounding file
rather than converting either way.

Because the work is a thesis artifact, provenance matters: e.g.
`assets/models/README.md` deliberately records that `mobilefacenet.tflite`
was extracted from the official campus Android APK and should be disclosed
honestly in the report. Keep that kind of note intact when editing.
```

## [memori] thesis-direction-agent-crossplatform.md

```markdown
---
name: thesis-direction-agent-crossplatform
description: The supervisor-revised thesis scope (face verification + intelligent agent, cross-platform) and the iOS-first → Android roadmap, so platform ports don't restart from scratch.
metadata:
  type: project
---

Supervisor's revised thesis direction (2026-09, not yet fully implemented):

**Revised title (dosen's wording):** "Pengembangan Presensi Berbasis Face
Verification dan Intelligent Agent pada Aplikasi KKN Cross-Platform
Menggunakan React Native."

**Two new claims the title makes that the app must be made to satisfy:**

1. **Intelligent Agent — scoped to the FACE RECOGNITION part only** (dosen was
   explicit about the scope). The app currently has NO AI agent; MobileFaceNet
   - TFLite is an inference pipeline, not an agent. The honest, defensible
     mapping is to frame the on-device verification decision system as a
     goal-based/reactive intelligent agent (Russell-Norvig), anchored on the
     already-built liveness challenge in hooks/useLivenessChallenge.ts — that IS
     a genuine perceive→act loop (senses head yaw, issues the next instruction,
     decides). Document it with PEAS. An optional adaptive element (agent picks
     challenges / adapts to lighting) strengthens "intelligent" beyond static
     rules. NOTE: none of the dosen's 8 test dimensions currently measure the
     agent, so at least one dimension (e.g. liveness/anti-spoof effectiveness)
     must cover it or the term reads as decorative.

2. **Cross-platform / Android vs iOS.** Reality: the app is iOS-only so far
   (repo lkh-kkn-ios, IPA via CI). React Native is cross-platform-capable but
   Android has not been produced. Two of the dosen's test options
   (performa Android vs iOS; konsistensi fungsi Android vs iOS) REQUIRE an
   actual Android build. Android is EASIER than iOS was: no Mac needed (builds
   on the user's Windows via Android Studio/EAS), and vision-camera /
   fast-tflite / vision-camera-face-detector all support Android. Gotcha: the
   face pipeline has iOS-specific behavior (the transposed landmark
   coordinates fixed in eyePair() were iOS-only; ML Kit may differ on Android),
   so alignment must be re-verified and possibly re-calibrated on Android.

**Agreed sequence:** finish/harden iOS first, then develop Android.

**Dosen's 8 evaluation dimensions:** akurasi verifikasi wajah; FAR/FRR; waktu
verifikasi; robustness pencahayaan; performa Android vs iOS; konsumsi resource;
keberhasilan deployment; konsistensi fungsi Android vs iOS. Feasibility notes:
accuracy + FAR/FRR come straight from tools/face-calibration; verification time
and resource use are instrumentable (resource profiling is easy on Android,
hard on iOS without a Mac); lighting robustness needs varied-lighting photos.

**RESOLVED (2026-09, from the extracted APK): "Laravel" was a mix-up.**
Three distinct things must not be conflated:

- Official Android app = FLUTTER/Dart (flutter_assets/, libflutter.so +
  libapp.so, 49x "Dart" in NOTICES; ZERO "Laravel" anywhere). Campus-owned,
  only reverse-engineered - NOT the student's to edit.
- Backend/server = PHP, evidence points to Yii2 ({name,message}
  "Unauthorized" error shape), NOT Laravel. Campus-owned.
- The student's own app = REACT NATIVE (this repo). iOS now, Android next.
  So "update the Android app like the iPhone version" does NOT mean editing the
  Flutter app - it means BUILDING the student's React Native app for Android
  (one codebase, two platforms). That is the actual cross-platform story.

**Why this memory exists:** the user explicitly wants the iOS know-how
preserved so a later Android (or other-platform) port is not painful.

Related: [[face-verification-pipeline]], [[face-calibration-results]],
[[android-app-reverse-engineering]], [[face-mismatch-open-issue]].

**PROGRESS (2026-09-13):** iOS maturing continues. Server URL centralized as API_BASE in utils/api.ts. NOTE: briefly pointed at
lkh-dev (the supervisor's source host) but REVERTED to prod (lkh-kkn) -
lkh-dev is campus-internal and unreachable from a public network (measured:
prod 200, dev connect-fail/000), so it broke login for a real account. Keep
prod as default.
Face-data endpoints corrected to key on numeric peserta `id` (was nim).
PEMBIMBING side started IN THE RN APP (user + dosen agreed to unify on React
Native, retire the Flutter app): P1 = utils/pembimbingApi.ts (6 endpoints,
keyed by NIP); P2 = login "Dosen" tab wired (utils/demoMode
startDemoPembimbingSession), @user_role routing in app/(tabs)/index.tsx, and
components/PembimbingScreen.tsx (roster dashboard, sample data in demo since
there is NO supervisor account on dev yet). P3 (next) = per-student LKH status

- check/approve (/api/lkh-check, /api/lkh-approved). BLOCKER for verifying the
  pembimbing side live: need a supervisor test account on lkh-dev from the dosen.
```

## [memori] lkh-kkn-app-overview.md

```markdown
---
name: lkh-kkn-app-overview
description: What the lkh-kkn-ios project is, its stack, and why it can only be built/tested through a native iOS build (no Expo Go, no local Mac).
metadata:
  type: project
---

`lkh-kkn-ios` is a skripsi (undergraduate thesis) project: an unofficial iOS
client for UIN Alauddin's LKH KKN daily attendance system
(`https://lkh-kkn.uin-alauddin.ac.id`). The official app is Android-only
(Flutter); this reimplements it for iPhone with on-device face verification
added to stop "titip absen" (proxy attendance).

Stack: Expo SDK 54 / expo-router (file-based, but `app/(tabs)/index.tsx`
renders its own custom tab bar and switches between LoginScreen /
LKHScreen / ProfileScreen manually — no real `Tabs` navigator), RN 0.81,
New Architecture on, react-native-vision-camera 5.x +
react-native-vision-camera-face-detector (ML Kit) +
react-native-fast-tflite (MobileFaceNet).

Build constraint that shapes everything: the Nitro/native modules mean the
app **cannot run in Expo Go** — it needs a custom dev client or a full
native build. The developer works on **Windows with no Mac**, so iOS builds
go through the GitHub Actions macOS runner
(`.github/workflows/build-ios.yml`, manual `workflow_dispatch`), which
produces an **unsigned IPA** that gets re-signed and sideloaded with
KSign/Sideloadly/AltStore using a free Apple ID. Consequence: nothing can
be verified locally — no simulator, no Xcode console — so debugging leans
on in-app diagnostics (debug photo overlay, error strings that embed native
diagnostics, the on-device similarity log). See PANDUAN-BUILD-IPA.md.

Related: [[face-verification-pipeline]], [[lkh-server-api-constraints]].
```

## [memori] face-verification-pipeline.md

```markdown
---
name: face-verification-pipeline
description: How face enrollment/verification is wired across files in lkh-kkn-ios, the thresholds involved, and the invariant that must never be broken when refactoring.
metadata:
  type: project
---

The anti-titip-absen face check spans four files, and the relationship
between them is the part that is easy to break and hard to re-derive:

- `utils/faceAuthNative.ts` — the ONLY pipeline: detect single face on the
  still photo -> `qualityGate()` -> crop/rotate-level/crop/resize to 112x112
  -> decodeJpeg -> `(px-127.5)/128` -> MobileFaceNet tflite -> L2-normalize
  192-d embedding. Also owns the shared thresholds and cosine
  `faceSimilarity()`.
- `utils/faceEnrollment.ts` — persistence only (`@face_enrollment_v3`,
  3-5 embeddings + photo URIs), `bestSimilarityToEnrollment()` (max-of-N),
  reset budget (`@face_reference_reset_count`, max 3). Imports from
  faceAuthNative, never the reverse.
- `components/FaceEnrollmentModal.tsx` — the 3-5 photo enrollment flow.
- `hooks/useFaceQualityGate.ts` — live-preview guidance ONLY, not
  authoritative; reuses the same exported threshold constants.

**Invariant:** enrollment captures and attendance probes must both go
through the exact same `getFaceEmbedding()` call. Any preprocessing that
diverges between the two sides silently wrecks similarity scores. Do not
add an enroll-specific or verify-specific image path.

Thresholds (all uncalibrated guesses, explicitly flagged as such in the
code): `FACE_MATCH_THRESHOLD = 0.6` (verification),
`ENROLLMENT_CONSISTENCY_MIN = 0.35` (mid-enrollment person-swap check only —
deliberately loose because the capture prompts push same-face captures
apart; must stay a separate constant), `MIN_FACE_SIZE_RATIO 0.15`,
`MAX_YAW_DEG 25`, `MAX_PITCH_DEG 20`, `MIN_EYE_OPEN_PROB 0.4`.

Deliberate design choices worth not re-litigating: the crop/align happens
on the captured still photo, not a live frame, because
vision-camera-resizer 5.2.1 cannot crop to a sub-rectangle; the live camera
in both modals runs with `runLandmarks={false} runClassifications={false}`
as a SIGSEGV workaround while the still-photo path keeps them on; logout
deliberately does NOT wipe the enrolled face (personal device, not shared).

**MEASURED, not inferred (2026-08-27):** this model L2-normalizes its own
output - ||y|| = 1.0 for every input tried under a desktop TFLite
interpreter. `l2Normalize()` in faceAuthNative.ts is therefore a no-op kept
only as a guard. Because embeddings are unit vectors, cosine and Euclidean
are interconvertible (d^2 = 2 - 2\*cos), so the Android app's distance-style
threshold and our cosine one rank pairs identically.

Enrollment now lives on the SERVER (utils/faceServer.ts + the sync layer in
faceEnrollment.ts), mirroring the Android app; local AsyncStorage was demoted
to a cache with a pending-push flag. See [[android-app-reverse-engineering]].
Calibration harness: tools/face-calibration/calibrate.py.

Related: [[face-mismatch-open-issue]], [[lkh-kkn-app-overview]].
```

## [memori] face-calibration-results.md

```markdown
---
name: face-calibration-results
description: The real root cause of the face-verification bug (missing canonical alignment), the constants it produced, and the harness mistake that produced a wrong answer first.
metadata:
  type: project
---

Calibrated with `tools/face-calibration/calibrate.py` on 19 owner photos
(two sessions) + 5 other people, 2026-08-27.

**Root cause: the model needs canonical ArcFace alignment, not box crops.**
MobileFaceNet of this lineage is trained on faces warped onto the 5-point
112x112 template. Feeding it "detector box padded by a ratio" raises no
error but collapses the embedding space. Similarity between DIFFERENT
people: box crop 1.3 -> 0.656 mean / 0.748 worst; box crop 2.0 -> 0.528 /
0.690; canonical alignment -> 0.338 / 0.500. Owner-vs-owner rose 0.763 ->
0.805 at the same time. With box cropping the worst impostor (0.748) beat
the worst genuine (0.423) - no threshold could ever have worked, which is
why threshold tuning alone kept failing. Full sweep went from d' 2.64 /
EER 11.4% to **d' 6.37 / EER 0.00% / 100% accuracy**.

Two eye landmarks are enough: a similarity transform has 4 DOF and two
points pin all four. That matters because it is implementable with
expo-image-manipulator's rotate + crop + resize (no affine warp needed).
ML Kit supplies LEFT_EYE/RIGHT_EYE. Gotcha: rotate() pivots on the image
centre, so the eye midpoint must be tracked through the rotation - it does
not stay put once a crop has been clamped at a photo edge.

Applied: canonical alignment in `cropAlignResize()`, `FACE_MATCH_THRESHOLD`
0.47 (midpoint of worst-case genuine 0.565 vs worst-case impostor 0.374 over
400 randomised enrollment splits), `ENROLLMENT_CONSISTENCY_MIN` 0.35 -> 0.45,
median aggregation kept (best worst-case gap, +0.191). Thresholds from the
old box-crop pipeline are meaningless against the new one - the whole score
scale shifted.

**Mistake worth remembering:** the first calibration round concluded "crop
ratio 2.0, threshold 0.62" and it was wrong. The harness cropped once and let
PIL pad out-of-bounds area with BLACK, so at large ratios 35-65% of the
model input was black. The app never does that - it clamps. Any harness
change must keep mirroring `cropAlignResize()` step for step, or its numbers
do not apply to the app. Second lesson: one impostor identity was not enough
to see this; the collapse only became obvious once 5 different people scored
0.58-0.81 against EACH OTHER.

Related: [[face-verification-pipeline]], [[face-mismatch-open-issue]].
```

## [memori] face-mismatch-open-issue.md

```markdown
---
name: face-mismatch-open-issue
description: The open bug driving branch fix/face-verification — a different person's face can still pass attendance — plus the constraint the user placed on fixing it.
metadata:
  type: project
---

As of 2026-08-27, on branch `fix/face-verification`, the reported defect is:
**someone whose face differs from the enrolled face can still pass
attendance.** The user also asked for the whole codebase to be made more
efficient _without changing its functionality_, with the face detector
being the specific part to fix.

**Why:** verification switched to max-of-N
(`bestSimilarityToEnrollment` compares a probe against every one of the 3-5
enrolled embeddings and keeps the highest score). That gives an impostor N
chances to clear the bar instead of one, which inflates impostor scores.
`FACE_MATCH_THRESHOLD` was bumped 0.5 -> 0.6 as a _compensating guess_, not
a measurement — the code says so outright. There is also no liveness /
anti-spoof check at all, and the quality gate's yaw/pitch/eye limits are
likewise unmeasured.

**How to apply:** treat 0.6 as unvalidated when reasoning about false
accepts. Real calibration data exists on-device: every attempt is logged by
`logSimilaritySample()` into `@face_calibration_log` (200 entries, viewable
from ProfileScreen's similarity-log button) — collect self/other clusters
under the current max-of-N regime and move the threshold to where they
separate, rather than guessing again. Candidate hardening levers besides
the threshold: mean-of-N or "must beat K of N" instead of max-of-N,
rejecting probes whose margin over the runner-up is thin, and tightening
the quality gate. Any change here must keep the enroll/verify preprocessing
identical — see [[face-verification-pipeline]].

**UPDATE 2026-08-29:** the stranger-face bug was root-caused and fixed
(missing canonical alignment - see [[face-calibration-results]]), verified on
device (a sibling scored 0.34, rejected). A separate weakness was then found
and fixed: no liveness meant a STATIC PHOTO of the enrolled person passed
attendance (reproduced on device). hooks/useLivenessChallenge.ts now locks the
attendance shutter behind a head-turn challenge (turn one side -> centre ->
opposite side), verification-only, yaw-based (blink was ruled out - needs live
classifications, which trip the SIGSEGV crash). Known remaining gap: this
stops a static photo/screen, NOT a video replay - that needs a passive
anti-spoof model, deferred.
```

## [memori] lkh-server-api-constraints.md

```markdown
---
name: lkh-server-api-constraints
description: Non-obvious requirements for talking to the LKH KKN server (Dart User-Agent, device_info, expired accounts) and why demo mode exists.
metadata:
  type: project
---

The LKH KKN API was reverse-engineered from strings in the official Flutter
app's `libapp.so` — there is no documentation. Three hard requirements, all
discovered empirically (see `scripts/login-probe*.ps1`):

1. **Every** request to `lkh-kkn.uin-alauddin.ac.id` must send
   `User-Agent: Dart/3.8 (dart:io)` (`API_USER_AGENT` in
   `utils/deviceInfo.ts`). Cloudflare's WAF returns an HTML block page for
   non-Dart UAs. This applies to `<Image source={{headers}}>` too, not just
   `fetch` — profile photos silently fall back to a grey placeholder
   without it.
2. Every call carries `device_info` (a fixed fake Android fingerprint JSON,
   URL-encoded) and `version=1.1.1`; the server rejects requests whose
   device_info doesn't look like a real device.
3. Endpoints in use: `POST /auth/get-token` (FormData), `GET /api/peserta`,
   `GET /api/lkh`, `POST /api/simpan-lkh` (multipart with the selfie),
   `GET /api/profil-peserta`. Non-JSON/HTML responses mean an expired
   session — every caller falls back to local data rather than erroring.

**Accounts are tied to the KKN period.** Once the student's angkatan term
ends, login returns invalid-credentials permanently for every request
variant tried. That is why `utils/demoMode.ts` exists: `startDemoSession()`
writes a local-only `@demo_mode` flag, dummy token and dummy profile, which
opens the KKN-period and geofence gates so the camera/face features stay
testable. Face verification itself is NOT loosened in demo mode, and
records captured then are tagged `isDemo` and are never sent to the real
server. Logout clears `@demo_mode`.

Geofence (`utils/geofence.ts`) is a 10 km radius check, resolved per
student: `wilayahKec.setting.koordinat` first, else Nominatim geocoding of
kecamatan+kabupaten (cached), else fail-open — because face verification is
the primary defense and blocking a legitimate student over missing admin
data is worse.

Related: [[lkh-kkn-app-overview]].
```

## [memori] lkh-flutter-source-api.md

```markdown
---
name: lkh-flutter-source-api
description: Authoritative LKH KKN API + face pipeline read from the supervisor's REAL Flutter source (not the decompiled APK) - corrects several things this iOS app only guessed.
metadata:
  type: reference
---

Supervisor (nur.afif) shared the REAL Flutter source of the official LKH KKN
app: `https://gitlab.com/nur.afif/lkh-kkn.git` (Flutter/Dart, 29 lib files,
cloned to scratchpad to inspect). This is the actual source of the app we had
only reverse-engineered from the APK. It corrects our guesses:

**SERVER: two different hosts.**

- Supervisor's app: `https://lkh-dev.uin-alauddin.ac.id` (DEV/staging).
- Our iOS RN app: `https://lkh-kkn.uin-alauddin.ac.id` (PROD).
  This likely explains our persistent 422s - we were hitting prod; the dosen
  tests against dev. Deciding dev-vs-prod is still open.

**FACE-DATA ENDPOINTS - our field name was WRONG.**

- `POST /api/simpan-face-data`: FormData `{ "id": peserta.id, "face_data":
<embedding> }`. `id` is the NUMERIC peserta id (pengguna/peserta JSON has
  both `int id` AND `String kode`=NIM). Our faceServer.ts sent `nim` - must
  be `id`. `face_data` in Flutter is a SINGLE 192-array as a string
  (predictedData.toString()); our app stores MULTIPLE embeddings, a
  deliberate divergence (median-of-N) we keep since we control both RN ends.
- `GET /api/face-data?id=<numeric id>`; also `/api/reset-wajah`,
  `/api/jumlah-reset`, `/api/max-reset`, `/api/simpan-reset`.
- Flutter stores faceData BOTH server-side and in local sqflite.

**device_info / version / UA (the Vivo login bug source).**
Sent via a Dio interceptor: real `device_info_plus` AndroidDeviceInfo
(jsonEncode) + real `package_info` version - NOT hardcoded. Dio uses
dart:io so the User-Agent is naturally `Dart/x` (that is why our RN app had
to fake a Dart UA). On Vivo, real Build values (isPhysicalDevice false, or a
null field) likely trip the server's device check. Our fixed-fingerprint
approach is immune - keep it.

**FACE PIPELINE (lib/services/ml_service.dart) = the flawed box-crop we beat.**
crop = boundingBox + 10px, NO alignment; resize 112; `(px-128)/128`; RGB;
metric = EUCLIDEAN distance, threshold 0.5; runs on **GPU delegate**
(GpuDelegateV2 Android / GpuDelegate iOS). This is exactly the box-crop that
our calibration proved collapses the embedding space (impostor 0.748 >
genuine 0.423). So switching Android to our RN codebase (canonical
alignment, calibrated 0.47, median-of-N, liveness) is a genuine UPGRADE, not
a port. The GPU delegate is also a prime suspect for the Vivo FACE bug
(wrong/NaN embeddings on some Vivo GPUs); our fast-tflite CPU path avoids it.

**Feature scope Flutter has that our RN app does NOT yet:** the whole
PEMBIMBING (supervisor) side - screens pembimbing_utama/pembimbingan and
endpoints /api/pembimbing, /api/pembimbing-peserta, /api/peserta-bimbing,
/api/peserta-bimbing-lkh, /api/lkh-check, /api/lkh-approved,
/api/pembimbing-tanggal, /api/program, /api/simpan-program. Our RN app only
covers the peserta (student) side + face.

Related: [[thesis-direction-agent-crossplatform]], [[lkh-server-api-constraints]],
[[android-app-reverse-engineering]], [[face-calibration-results]].
```

## [memori] android-app-reverse-engineering.md

```markdown
---
name: android-app-reverse-engineering
description: What the decompiled official Android LKH KKN app reveals — full API map, server-side face storage, and which parts of its pipeline are NOT recoverable from the APK.
metadata:
  type: reference
---

The official Android app is already extracted and dumped on disk (not in
the repo) at `C:\Users\As Shadiq Nur\Documents\Skripsi\`:
`app-kkn.apk`, `apk_extracted/`, `libapp_strings.txt` (283 KB string dump
of the Flutter AOT blob), `classes_dex_strings.txt`, plus `jadx-gui-1.5.6.exe`
and a bundled `jre/` (system `java` is NOT on PATH; use that jre).

**The model needs no conversion at all.** `apk_extracted/assets/flutter_assets/
assets/mobilefacenet.tflite` and the repo's `assets/models/mobilefacenet.tflite`
are byte-identical (md5 `7945c78f4484c99560df461df85baa2f`).

**Its stack mirrors ours:** `google_mlkit_face_detector` + `tflite_flutter`
(TfLiteInterpreter C API) + that same model. So iOS already uses the same
detector family and the same weights.

**Biggest architectural difference — Android keeps the face on the SERVER,
iOS keeps it on the phone.** Endpoints found in `libapp_strings.txt`:
`/auth/get-token`, `/api/peserta`, `/api/profil-peserta`, `/api/lkh`,
`/api/simpan-lkh`, `/api/registrasi`, `/api/versi`, `/api/pembimbing*`,
`/api/peserta-bimbing*`, `/api/semua-lkh-peserta`, `/api/v2/ability/`, and
critically **`/api/face-data`, `/api/simpan-face-data`, `/api/reset-wajah`,
`/api/jumlah-reset`, `/api/max-reset`**. Its local sqflite DB `KKN_v327.db`
has tables kkn/lkh/peserta/pengguna/pembimbingan/pembimbing_peserta and
`reset(reset_peserta_id, reset_jumlah, reset_maksimum)` — i.e. the reset
budget is server-authoritative and merely cached; the `peserta` table has no
embedding column. Our iOS port reimplemented both locally
(`@face_enrollment_v3`, `MAX_FACE_RESETS = 3`). State this divergence
honestly in the thesis.

**What the APK does NOT give you:** the Dart logic is AOT-compiled, so the
string dump yields literals only — never the arithmetic. The six
preprocessing decisions (crop margin, eye alignment yes/no, resize
interpolation, normalization constants, channel order + front-camera
mirroring, metric + threshold) cannot be read out this way. jadx on
`classes.dex` won't help either — for a Flutter app that dex is mostly
plugin/ML Kit glue, not app logic.

Related: [[face-mismatch-open-issue]], [[lkh-server-api-constraints]].
```

---

# BAGIAN 2 — DOKUMEN INTELLIGENT AGENT

_Sumber: `docs/intelligent-agent.md` di repo._

# Intelligent Agent pada Verifikasi Wajah

Dokumen ini memformalkan komponen **Intelligent Agent** yang diminta pada
judul skripsi, dibatasi pada bagian **pengenalan wajah (face recognition)**.
Tujuannya: memberi rujukan yang bisa langsung dikutip di laporan, dan memetakan
setiap istilah agen ke kode nyata di repo ini.

> **Sifat komponen ini:** ia **tidak menambah perilaku baru**. Sistem
> keputusan on-device yang sudah ada dibingkai ulang dengan kosakata agen
> (Russell & Norvig, _Artificial Intelligence: A Modern Approach_). Fungsi
> keputusannya dipisah sebagai unit eksplisit di `utils/verificationAgent.ts`.

## 1. Apa yang membuatnya sebuah _agen_

Menurut Russell & Norvig, **agen** adalah entitas yang **mengindra**
lingkungan melalui _sensor_ dan **bertindak** atasnya melalui _aktuator_ untuk
mencapai sebuah _tujuan_. Sistem verifikasi wajah aplikasi ini memenuhinya:

- ia **mengindra** wajah, pose kepala, dan kondisi melalui kamera + ML Kit;
- ia **bertindak** dengan memberi instruksi ke pengguna dan memutuskan
  menerima/menolak absen;
- ia mengejar **tujuan** yang jelas: meloloskan pemilik wajah yang hadir &
  hidup, menolak impostor dan upaya spoofing.

Yang membedakannya dari sekadar "fungsi cocokkan wajah" adalah **loop
tantangan keaktifan (liveness)**: agen tidak menilai satu gambar lalu selesai —
ia memberi perintah gerak, mengamati respons, dan menyesuaikan langkah
berikutnya. Itu perilaku _perceive → decide → act_ yang berulang, ciri khas
agen.

## 2. Spesifikasi PEAS

| Elemen          | Isi                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance** | True-accept tinggi (pemilik hadir & hidup lolos); false-accept rendah (impostor & spoofing foto/layar ditolak); friksi pengguna minimal. Diukur: FAR, FRR, akurasi, keberhasilan liveness.                                                                 |
| **Environment** | Adegan selfie di depan kamera depan: manusia — atau foto/layar — dengan pencahayaan & pose beragam. **Sebagian teramati** (satu kamera, tanpa kedalaman), **dinamis** (subjek bergerak), **kontinu**, **sekuensial** (percept antar-frame saling terkait). |
| **Actuators**   | Instruksi di layar (tantangan gerak liveness, panduan framing) dan **keputusan akhir**: membuka shutter → menyimpan/menolak absen.                                                                                                                         |
| **Sensors**     | Frame kamera (VisionCamera); percept ML Kit: bounding box, landmark mata, sudut kepala (yaw/pitch/roll), ukuran wajah; serta **embedding 192-dimensi** MobileFaceNet dari foto still.                                                                      |

## 3. Tipe agen

**Goal-based agent** dengan **sub-loop reaktif berstate**.

- Bukan _simple reflex agent_: ia menyimpan **state internal** (tahap tantangan
  liveness yang sedang berjalan, arah tolehan pertama) dan mengejar **tujuan**
  ("keaktifan terbukti" lalu "identitas cocok"), bukan sekadar memetakan
  percept→aksi seketika.
- Sub-loop liveness bersifat **reaktif**: pada tiap frame ia bereaksi terhadap
  sudut yaw dan memilih instruksi berikut.
- Keputusan identitas bersifat **goal-directed**: membandingkan embedding ke
  seluruh set terdaftar dan memutuskan berdasar ambang.

## 4. Arsitektur & alur keputusan

```
        ┌─────────────────────────── AGEN VERIFIKASI WAJAH ───────────────────────────┐
        │                                                                              │
 kamera │  (1) PERSEPSI real-time            (2) SUB-AGEN LIVENESS (reaktif+state)      │
  ────► │  useFaceQualityGate                useLivenessChallenge                       │
        │  • wajah tunggal?                  • indra: yaw                               │
        │  • ukuran cukup?                   • state: tahap tantangan, tanda tolehan    │
        │  • pose lurus?                     • aksi: instruksi "toleh sisi lain"        │
        │        │                           • goal: dua tolehan berlawanan → passed    │
        │        └──────────► shutter TERKUNCI sampai liveness "passed" ◄───────┘       │
        │                                        │                                     │
        │                                        ▼ (jepret foto still)                 │
        │  (3) PERSEPSI still + KEPUTUSAN                                               │
        │  getFaceEmbedding  →  embedding 192-d                                         │
        │  decideAttendance  →  median-of-N similarity vs ambang 0.47                   │
        │        │                                                                     │
        │        ▼ aktuator                                                            │
        │   accepted → simpan absen   |   rejected → tolak   |   not-enrolled → daftar  │
        └──────────────────────────────────────────────────────────────────────────────┘
```

## 5. Pemetaan ke kode

| Bagian agen                               | Berkas / fungsi                                             |
| ----------------------------------------- | ----------------------------------------------------------- |
| Persepsi real-time (kualitas framing)     | `hooks/useFaceQualityGate.ts`                               |
| Sub-agen liveness (loop reaktif berstate) | `hooks/useLivenessChallenge.ts`                             |
| Persepsi still → embedding                | `getFaceEmbedding()` di `utils/faceAuthNative.ts`           |
| **Fungsi keputusan agen**                 | `decideAttendance()` di `utils/verificationAgent.ts`        |
| Metrik keputusan (median-of-N)            | `similarityToEnrollment()` di `utils/faceEnrollment.ts`     |
| Aktuator (instruksi + verdict UI)         | `takeSelfie()` & modal kamera di `components/LKHScreen.tsx` |

## 6. Di mana "kecerdasan"-nya

Tiga lapis, semuanya sudah ada di aplikasi:

1. **Persepsi berbasis deep learning.** Wajah diubah jadi embedding oleh
   MobileFaceNet (CNN) — bukan pencocokan piksel, melainkan representasi
   ruang-fitur hasil pelatihan.
2. **Pengambilan keputusan berstate & bertujuan.** Agen menggabungkan
   beberapa percept (kualitas, keaktifan, kemiripan) menuju satu putusan,
   dengan strategi agregasi median yang dipilih lewat kalibrasi
   (`tools/face-calibration/`).
3. **Interaksi challenge–response.** Agen aktif menantang lingkungan (perintah
   gerak) dan menilai respons — inti anti-spoofing.

## 7. Batasan (disebutkan jujur)

- Sub-agen liveness menghentikan **foto/layar statis**, **bukan** pemutaran
  **video** wajah yang menoleh. Menahan video butuh model anti-spoof pasif
  (analisis tekstur/moire) — di luar cakupan versi ini.
- Verifikasi identitas berbasis **satu foto still**; tidak ada fusi
  multi-frame untuk identitas (hanya untuk liveness).
- Lingkungan **sebagian teramati** (tanpa data kedalaman/TrueDepth).

## 8. Cara mengukur agen (untuk bab pengujian)

Karena judul memuat "Intelligent Agent", evaluasi sebaiknya memuat minimal
satu dimensi yang menguji agennya, bukan hanya akurasi wajah:

- **Efektivitas liveness / anti-spoofing:** tingkat penolakan terhadap
  serangan foto & layar vs tingkat penerimaan wajah asli.
- **Keberhasilan & waktu penyelesaian tantangan:** berapa lama pengguna sah
  menuntaskan dua tolehan; berapa persen gagal karena pencahayaan/pose.
- Dimensi identitas (akurasi, FAR/FRR, waktu verifikasi) melengkapi, tetapi
  bukan pengganti pengukuran agen di atas.

---

# BAGIAN 3 — KALIBRASI & PENGUJIAN

_Sumber: `tools/face-calibration/README.md` di repo._

# Kalibrasi preprocessing & threshold wajah

Alat ini menjawab satu pertanyaan yang tidak bisa dijawab dari dalam
aplikasi: **kombinasi preprocessing mana yang benar, dan di angka berapa
`FACE_MATCH_THRESHOLD` seharusnya dipasang.**

## Kenapa perlu

Model `mobilefacenet.tflite` di repo ini **byte-identik** dengan yang ada di
dalam APK aplikasi Android resmi (md5 `7945c78f4484c99560df461df85baa2f`).
Jadi modelnya tidak perlu dikonversi sama sekali.

Yang tidak ikut terbawa adalah keputusan di sekelilingnya — margin crop,
alignment, interpolasi resize, konstanta normalisasi, urutan channel, dan
threshold. Semua itu tidak bisa dibaca dari APK karena kode Dart-nya
AOT-compiled: string dump hanya memberi literal, bukan aritmetikanya.

Masalahnya, preprocessing yang meleset **tidak memunculkan error**. Model
tetap mengeluarkan embedding; hanya daya pisahnya yang rusak, sehingga
distribusi "wajah sendiri" dan "wajah orang lain" saling tumpang tindih.
Gejalanya persis keluhan yang sedang diperbaiki: wajah orang lain bisa lolos
absen.

## Yang sudah terverifikasi

Model ini **sudah me-L2-normalize keluarannya sendiri** (‖y‖ = 1.0 untuk
setiap input yang diuji). Konsekuensinya, cosine similarity dan Euclidean
distance hanyalah dua skala dari besaran yang sama:

```
d² = 2 − 2·cos        cos = 1 − d²/2
```

Keduanya memberi peringkat identik. Jadi threshold gaya "distance" milik
Android dan gaya "cosine" milik iOS bisa saling diterjemahkan — kolom `d_eq`
pada laporan menampilkan padanan Euclidean dari threshold yang disarankan.

## Hasil kalibrasi 2026-08-27

Data: 19 foto pemilik (dua sesi terpisah) + 5 orang lain. Tidak ada pasangan
nyaris identik, jadi variasi genuine-nya nyata.

### Temuan utama: model ini butuh alignment kanonik, bukan crop bbox

MobileFaceNet lineage ini dilatih atas wajah yang sudah di-warp ke template
5-titik ArcFace, bukan atas "kotak deteksi yang dilebarkan sekian rasio".
Memberi crop bbox tidak memunculkan error — model tetap mengeluarkan
embedding — tapi ruang embedding-nya kolaps. Kemiripan antara orang-orang
yang **jelas berbeda**:

| Preprocessing                    | beda orang (rata²) | terburuk  | sesama pemilik (rata²) |
| -------------------------------- | ------------------ | --------- | ---------------------- |
| crop bbox rasio 1.3 (versi lama) | 0.656              | 0.748     | 0.763                  |
| crop bbox rasio 2.0              | 0.528              | 0.690     | 0.750                  |
| **alignment kanonik**            | **0.338**          | **0.500** | **0.805**              |

Dengan crop bbox, skor impostor terburuk (0.748) **melampaui** skor genuine
terburuk (0.423) — tidak ada ambang mana pun yang bisa memisahkan keduanya.
Itulah sebab sebenarnya wajah orang lain bisa lolos absen; bukan soal
normalisasi, bukan soal angka ambang.

Setelah alignment diperbaiki, sapuan penuh 80 varian memberi **d′ 6.37,
EER 0.00%, akurasi 100%** (sebelumnya d′ 2.64, EER 11.4%).

### Faktor lain

| Faktor          | Hasil                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| Normalisasi     | `(x-128)/128` ≈ `(x-127.5)/128` ≈ `(x-127.5)/127.5` — setara; `x/255` lebih buruk  |
| Channel         | RGB jelas mengungguli BGR                                                          |
| Skala template  | 1.0 dan 1.1 praktis seri (6.32 vs 6.37); dipakai 1.0 karena itu nilai kanonik      |
| Rotasi leveling | pengaruh kecil (6.32 vs 6.17) — tetap dipakai karena benar secara teori dan gratis |

Jadi normalisasi dan urutan channel di aplikasi memang **sudah benar sejak
awal**.

### Strategi penggabungan & ambang

Validasi silang 400 subset enrollment acak (ukuran 3–5, kedua arah sesi),
dengan alignment kanonik — **semua strategi lolos 400/400 tanpa tumpang
tindih**. Yang membedakan adalah jarak kasus-terburuk:

| strategi   | genuine terburuk | impostor terburuk | jarak      |
| ---------- | ---------------- | ----------------- | ---------- |
| max        | 0.579            | 0.422             | +0.157     |
| top2       | 0.572            | 0.398             | +0.174     |
| mean       | 0.562            | 0.380             | +0.182     |
| **median** | 0.565            | **0.374**         | **+0.191** |

Dipakai **median**, dan `FACE_MATCH_THRESHOLD = 0.47` — titik tengah jarak
kasus-terburuk itu, sehingga kedua jenis kesalahan punya ruang aman setara
(~0.10 masing-masing).

Angka ini jauh di bawah 0.6 yang dipakai sebelumnya, dan itu wajar: ambang
lama dikalibrasi atas embedding hasil crop bbox, tempat semua wajah
berskor tinggi terhadap semua wajah. Ambang dari pipeline lama tidak berlaku
untuk pipeline baru.

### Batas keabsahan

Lima identitas impostor masih sedikit, dan empat di antaranya menyumbang satu
foto saja. Skor impostor terburuk adalah angka yang paling mungkin
diremehkan. Ulangi kalibrasi begitu ada lebih banyak wajah.

### Catatan koreksi

Kalibrasi putaran pertama (sebelum foto orang ke-2 sampai ke-5 masuk)
menyimpulkan "margin crop 2.0 dan ambang 0.62". Kesimpulan itu **keliru**:
harness saat itu memotong satu kali dan membiarkan area di luar batas gambar
terisi hitam, sehingga pada margin besar 35–65% masukan model menjadi hitam.
Aplikasi tidak pernah berperilaku begitu — ia menjepit crop. Harness sudah
diperbaiki agar meniru `cropAlignResize()` langkah demi langkah; angka di
halaman ini berasal dari harness yang sudah benar.

## Menyiapkan bahan uji

Buat folder foto, satu subfolder per orang:

```
photos/
  saya/        <- minimal 5 foto wajah Anda (3 enrollment + 2 probe)
  orang-1/     <- minimal 2 foto per orang lain
  orang-2/
  orang-3/
```

Target minimal yang benar-benar berguna: **8 foto Anda + 4 orang lain @ 3
foto**. Makin banyak orang lain, makin dipercaya angka impostor-nya —
merekalah yang menentukan seberapa aman threshold-nya.

Untuk foto Anda sendiri, sengaja variasikan: pencahayaan berbeda, dengan dan
tanpa kacamata, ekspresi berbeda, sedikit menoleh. Justru kondisi sulit itu
yang menentukan seberapa rendah threshold boleh dipasang tanpa menolak Anda
sendiri.

Foto orang lain boleh dari siapa saja yang bersedia — teman satu posko
paling ideal, karena merekalah yang realistis akan mencoba titip absen.

## Menjalankan

```powershell
# sekali saja
py -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

# tiap kali
.\.venv\Scripts\python calibrate.py --photos photos
```

Opsi yang berguna:

| Opsi             | Arti                                       |
| ---------------- | ------------------------------------------ |
| `--full`         | ikutkan varian mirror (2× lebih lama)      |
| `--self-id nama` | nama subfolder wajah Anda (default `saya`) |
| `--enroll 3`     | jumlah foto enrollment yang disimulasikan  |
| `--top 20`       | berapa baris teratas yang ditampilkan      |

## Membaca hasilnya

Tabel diurutkan berdasarkan **d-prime** — jarak antara rata-rata skor
genuine dan impostor, dalam satuan simpangan baku. Dipakai sebagai skor utama
karena tidak bergantung pada pemilihan threshold. Makin besar makin baik;
di bawah ~2 berarti pemisahannya lemah.

Kolom lain: `EER` (titik saat kesalahan menerima = kesalahan menolak, makin
kecil makin baik), `thr` (threshold cosine di titik itu), `d_eq` (padanan
Euclidean-nya), `akur` (akurasi terbaik yang bisa dicapai).

Blok **REKOMENDASI** menyebut kombinasi pemenang dan angka threshold-nya.
Kalau muncul peringatan bahwa distribusi masih tumpang tindih, jangan kunci
angkanya dulu — tambah foto, terutama foto orang lain.

Blok **STRATEGI PENGGABUNGAN** membandingkan `max` / `top2` / `mean` /
`median` terhadap N wajah terdaftar. Sejak kalibrasi 2026-08-27 aplikasi
memakai `median` (`similarityToEnrollment` di `utils/faceEnrollment.ts`);
sebelumnya `max`, yang memberi impostor N kesempatan menembus ambang
alih-alih satu. Kalau kalibrasi ulang memenangkan baris lain, ganti di sana.

## Memindahkan hasilnya ke aplikasi

| Temuan                | Diterapkan di                                                |
| --------------------- | ------------------------------------------------------------ |
| Konstanta normalisasi | `fileToNormalizedInputBuffer()` di `utils/faceAuthNative.ts` |
| Skala template        | konstanta `ARC_*` di `utils/faceAuthNative.ts`               |
| Alignment kanonik     | `cropAlignResize()` di `utils/faceAuthNative.ts`             |
| Threshold             | `FACE_MATCH_THRESHOLD` di `utils/faceAuthNative.ts`          |
| Strategi penggabungan | `similarityToEnrollment()` di `utils/faceEnrollment.ts`      |

Simpan `hasil-kalibrasi.csv` — tabel d-prime/EER lengkapnya layak dipakai
sebagai lampiran metodologi skripsi, menggantikan konstanta yang sebelumnya
ditandai "tebakan" di dalam kode.

## Catatan tentang detektor

Deteksi wajah di sini memakai BlazeFace (mediapipe), bukan ML Kit seperti di
perangkat. Keduanya BUKAN detektor yang sama persis, jadi kotak wajahnya bisa
sedikit berbeda. Itu tidak menggugurkan hasilnya: detektor yang sama dipakai
untuk seluruh varian, sehingga perbandingan antar-varian tetap adil. Yang
perlu diingat hanyalah bahwa nilai threshold absolutnya sebaiknya diverifikasi
sekali di perangkat lewat log kemiripan di halaman Profil.
