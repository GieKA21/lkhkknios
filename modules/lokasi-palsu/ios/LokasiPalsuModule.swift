import CoreLocation
import ExpoModulesCore

/// Mengambil satu posisi GPS beserta penanda apakah posisi itu disimulasikan.
///
/// expo-location tidak meneruskan penanda ini di iOS (properti `mocked`-nya
/// hanya terisi di Android), padahal aplikasi Flutter resmi menolak presensi
/// dengan lokasi palsu di kedua platform lewat `Position.isMocked` dari
/// geolocator. Di iOS 15 ke atas nilai itu berasal dari
/// `CLLocation.sourceInformation.isSimulatedBySoftware`, dan itulah yang
/// dibaca di sini.
///
/// Izin lokasi TIDAK diminta di sini - utils/geofence.ts sudah memintanya
/// lewat expo-location sebelum memanggil modul ini.
public class LokasiPalsuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LokasiPalsu")

    // Di antrean utama: CLLocationManager harus dibuat di thread yang punya
    // run loop agar delegate-nya dipanggil.
    AsyncFunction("ambilLokasi") { (promise: Promise) in
      PengambilLokasi(promise: promise).mulai()
    }.runOnQueue(.main)
  }
}

final class PengambilLokasi: NSObject, CLLocationManagerDelegate {
  // Menahan objek ini tetap hidup sampai delegate menjawab; CLLocationManager
  // hanya memegang delegate secara weak.
  private static var berjalan = Set<PengambilLokasi>()

  private let manager = CLLocationManager()
  private let promise: Promise
  private var selesai = false

  init(promise: Promise) {
    self.promise = promise
    super.init()
  }

  func mulai() {
    PengambilLokasi.berjalan.insert(self)
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let lokasi = locations.last else { return }
    let simulasi = lokasi.sourceInformation?.isSimulatedBySoftware ?? false
    akhiri {
      self.promise.resolve([
        "latitude": lokasi.coordinate.latitude,
        "longitude": lokasi.coordinate.longitude,
        "akurasi": lokasi.horizontalAccuracy,
        "simulasi": simulasi,
      ])
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    akhiri {
      self.promise.reject("E_LOKASI", error.localizedDescription)
    }
  }

  private func akhiri(_ jawab: () -> Void) {
    guard !selesai else { return }
    selesai = true
    jawab()
    manager.delegate = nil
    PengambilLokasi.berjalan.remove(self)
  }
}
