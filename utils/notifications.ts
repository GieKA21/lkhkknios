import * as Notifications from "expo-notifications";

/**
 * Local (on-device) reminder notifications nudging the user to fill in
 * today's LKH attendance if they haven't yet, at 10:00 and 20:00.
 *
 * Expo's local notification triggers can't run conditional logic at fire
 * time, so "only if not yet absen" is approximated by (re)scheduling these
 * as one-off notifications for *today* every time
 * scheduleDailyAttendanceReminders() runs - call it on app load and right
 * after attendance is saved. Already-passed times are skipped, and both
 * reminders are cancelled outright once today's attendance is saved. This
 * means a fresh day's reminders only get (re)armed once the app is opened
 * that day - there's no true background daily scheduling without a
 * push/background-task server, which is out of scope here.
 */

const MORNING_REMINDER_ID = "lkh-attendance-reminder-morning";
const EVENING_REMINDER_ID = "lkh-attendance-reminder-evening";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function requestNotificationPermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return !!requested.granted;
}

function todayAt(hour: number, minute: number): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

/**
 * (Re)schedules today's 10:00/20:00 attendance reminders, skipping times
 * that already passed and skipping entirely if `hasAttendedToday` is true
 * or the KKN period is no longer running.
 *
 * KENAPA PERIODE IKUT DIPERIKSA DI SINI. Dilaporkan dari perangkat pada
 * 18 Oktober 2026: periode KKN angkatan ini berakhir 24 September, tetapi
 * pengingat "Belum Absen LKH" tetap muncul tiap hari. Aplikasi menagih
 * pekerjaan yang ia sendiri akan tolak - LKHScreen memblokir absen di luar
 * periode lewat isWithinKKNPeriod(). Dulu syaratnya hanya "sudah absen hari
 * ini", sehingga mahasiswa yang KKN-nya sudah selesai - yang selamanya tidak
 * akan pernah absen lagi - justru diingatkan tanpa henti.
 *
 * Pembatalan di dua baris pertama dijalankan LEBIH DAHULU dan tanpa syarat,
 * jadi pengingat yang terlanjur terjadwal sebelum periodenya habis ikut
 * tercabut begitu fungsi ini dipanggil lagi.
 *
 * KENAPA PEMANGGILAN DIANTREKAN. Dilaporkan dari perangkat pada 13 November
 * 2026: pengingat tetap muncul walau hari itu sudah absen. Fungsi ini
 * dipanggil beberapa kali berdekatan (catatan absen dan periode KKN termuat
 * bergantian), dan dahulu pemanggilan-pemanggilan itu berjalan bersamaan:
 * pemanggilan lama yang masih menunggu izin notifikasi menjadwalkan
 * pengingat SESUDAH pemanggilan baru membatalkannya. Dengan antrean, tiap
 * pemanggilan baru mulai setelah yang sebelumnya tuntas, sehingga keputusan
 * pemanggilan TERAKHIR yang berlaku.
 */
let antrean: Promise<void> = Promise.resolve();

export function scheduleDailyAttendanceReminders(
  hasAttendedToday: boolean,
  dalamPeriodeKKN: boolean,
): Promise<void> {
  const giliran = antrean.then(() =>
    jadwalkanPengingat(hasAttendedToday, dalamPeriodeKKN),
  );
  // Kegagalan satu giliran tidak boleh memutus antrean berikutnya.
  antrean = giliran.catch(() => {});
  return giliran;
}

/** Buang pengingat absen yang SUDAH tampil di panel notifikasi. */
async function singkirkanPengingatTampil(): Promise<void> {
  const tampil = await Notifications.getPresentedNotificationsAsync();
  for (const n of tampil) {
    const id = n.request.identifier;
    if (id === MORNING_REMINDER_ID || id === EVENING_REMINDER_ID) {
      await Notifications.dismissNotificationAsync(id).catch(() => {});
    }
  }
}

async function jadwalkanPengingat(
  hasAttendedToday: boolean,
  dalamPeriodeKKN: boolean,
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(MORNING_REMINDER_ID).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(EVENING_REMINDER_ID).catch(() => {});

  if (hasAttendedToday || !dalamPeriodeKKN) {
    // Pengingat pukul 10.00 yang terlanjur tampil tidak lagi benar begitu
    // absen tersimpan; jangan dibiarkan menagih di panel notifikasi.
    await singkirkanPengingatTampil().catch(() => {});
    return;
  }

  const granted = await requestNotificationPermissions();
  if (!granted) return;

  const now = new Date();
  const morning = todayAt(10, 0);
  const evening = todayAt(20, 0);

  if (morning > now) {
    await Notifications.scheduleNotificationAsync({
      identifier: MORNING_REMINDER_ID,
      content: {
        title: "Belum Absen LKH",
        body: "Jangan lupa isi laporan dan foto absensi hari ini ya!",
        // sound WAJIB di konten agar berbunyi saat notifikasi menyala di
        // latar - shouldPlaySound di handler hanya untuk saat app terbuka.
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morning,
      },
    });
  }

  if (evening > now) {
    await Notifications.scheduleNotificationAsync({
      identifier: EVENING_REMINDER_ID,
      content: {
        title: "Belum Absen LKH",
        body: "Hari sudah malam dan kamu belum absen LKH hari ini. Segera isi sebelum lupa!",
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: evening,
      },
    });
  }
}
