# Rencana: tombol uji pengingat absen

**Status: rencana, belum dikerjakan.** Dibuat 27 Oktober 2026 atas permintaan
untuk keperluan peragaan pada seminar hasil.

## Persoalan

Pengingat absen dijadwalkan pada pukul 10.00 dan 20.00 melalui
`scheduleDailyAttendanceReminders()` di `utils/notifications.ts`. Jam seminar
hasil tidak akan jatuh pada salah satu jam tersebut, dan mengubah jam
penjadwalan hanya demi peragaan akan mengubah perilaku yang justru sedang
dilaporkan dalam naskah. Diperlukan satu pemicu manual yang membunyikan
pengingat yang sama persis, tanpa menyentuh jadwal yang sebenarnya.

## Rancangan

Tambah satu fungsi di `utils/notifications.ts`:

```
export async function picuPengingatUji(jedaDetik = 5): Promise<boolean>
```

- memakai identifier tersendiri, `lkh-attendance-reminder-uji`, sehingga
  pembatalan pada `scheduleDailyAttendanceReminders()` tidak ikut mencabutnya
  dan sebaliknya;
- isi notifikasi disalin apa adanya dari pengingat pukul 20.00, supaya yang
  tampil di layar proyektor adalah pengingat yang sesungguhnya, bukan tiruan;
- pemicu `TIME_INTERVAL` dengan `seconds: jedaDetik`, cukup untuk menekan
  tombol lalu menutup aplikasi agar spanduk notifikasi terlihat di layar kunci;
- mengembalikan `false` bila izin notifikasi ditolak, agar tombol dapat
  memberi tahu alih-alih diam.

Tombolnya diletakkan di `components/LKHScreen.tsx`, pada bagian yang sama
dengan kartu absen, berlabel **"Uji pengingat absen"**.

## Saklar

Tombol ini tidak boleh ada pada aplikasi yang diserahkan. Kendalinya satu
konstanta sumber di dekat awal `LKHScreen.tsx`, sejalan dengan pola
`ABAIKAN_PERIODE_KKN` yang sudah dipakai:

```
const TOMBOL_UJI_PENGINGAT = false;
```

Nilai bakunya `false` di dalam repositori. Dinyalakan hanya pada salinan kerja
sesaat sebelum membangun berkas untuk peragaan, lalu dikembalikan. Alasan
memakai konstanta sumber dan bukan variabel lingkungan sama dengan alasan pada
cabang `demo/seminar`: singgahan transformasi Metro hanya memperhatikan isi
berkas, sehingga nilai dari lingkungan dapat terbawa basi dari pembangunan
sebelumnya.

Pembuktian sebuah berkas benar-benar bersih: `TOMBOL_UJI_PENGINGAT` harus
tidak ditemukan pada berkas bundel yang dihasilkan.

## Yang tidak berubah

- jam 10.00 dan 20.00 tetap;
- pemeriksaan periode KKN pada penjadwalan tetap;
- tidak ada penjadwalan latar belakang baru; keterbatasan yang tertulis pada
  komentar kepala `utils/notifications.ts` tetap berlaku dan tetap perlu
  disebutkan apa adanya di naskah.

## Catatan untuk naskah

Pengingat absen adalah fitur tambahan aplikasi ini, bukan temuan penelitian.
Pada seminar hasil ia diperagakan sebagai bagian dari spesifikasi fungsional,
dan tombol pemicunya disebut sebagai alat peraga, bukan bagian dari produk.
