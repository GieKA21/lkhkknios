Pod::Spec.new do |s|
  s.name           = 'LokasiPalsu'
  s.version        = '1.0.0'
  s.summary        = 'Membaca lokasi beserta penanda lokasi simulasi dari iOS.'
  s.description    = 'Modul lokal LKH KKN: CLLocation.sourceInformation.isSimulatedBySoftware, penanda yang juga dibaca geolocator (isMocked) di aplikasi Flutter resmi.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
