/**
 * Token sesi lokal peninggalan "Mode Demo". Fitur demo (login demo, toggle
 * mode demo, dashboard contoh dosen) sudah DIHAPUS dari aplikasi.
 *
 * Konstanta ini DIPERTAHANKAN karena utils/faceEnrollment.ts masih memakainya
 * sebagai penanda namespace penyimpanan wajah (memisahkan data sesi demo lama
 * dari akun asli). Tidak ada sesi yang akan bernilai token ini lagi, jadi
 * efektifnya storageKeys selalu memilih namespace "akun asli" - tapi menghapus
 * penanda ini sepenuhnya berarti mengubah logika storageKeys yang kritikal
 * untuk verifikasi wajah, jadi sengaja dibiarkan agar aman.
 */
export const DEMO_TOKEN = "demo-token-lokal";
