CollMind TPM - Planlama Modülü Detaylı Özeti
📋 Modül Genel Bakış
Planlama Modülü, Trade Marketing Planner'ların promosyon planları oluşturduğu, optimize ettiği ve onaya gönderdiği ana çalışma alanıdır. Gerçek zamanlı KPI hesaplamaları, hiyerarşik FU/SKU grid yapısı ve RAG durum değerlendirmesi ile planların karlılığını anlık olarak görüntüler.
🎯 Kullanıcı Rolleri ve Sorumlulukları
1. Trade Marketing Planner (Planlayıcı)
Table
Copy
Alan	Detay
Amacı	Promosyon planlarını oluşturmak, optimize etmek ve onaya göndermek
Erişim Seviyesi	Sadece atanmış CPL ve Kategori kombinasyonları
Ana Ekranları	Plan Listesi, Detaylı Planlama Ekranı (Grid)
Temel Sorumlulukları:
✅ Yeni promosyon planı oluşturma
✅ FU (Forecasting Unit) ve SKU ekleme
✅ SKU seviyesinde planlanan hacim girişi
✅ FU seviyesinde promosyon taktikleri (indirimler, harcamalar) girme
✅ Gerçek zamanlı ROI ve RAG durumunu analiz etme
✅ Kırmızı (RED) durumdaki ürünleri optimize etme
✅ Planı Category Manager'a onaya gönderme
2. Category Manager (Kategori Yöneticisi)
Table
Copy
Alan	Detay
Amacı	Planları stratejik uygunluk ve karlılık açısından incelemek
Erişim Seviyesi	Sadece atanmış kategorilerdeki planlar
Ana Ekranları	Onay Kuyruğu, Plan İnceleme Ekranı
Temel Sorumlulukları:
✅ Bekleyen planları inceleme (read-only mod)
✅ Grand Totals Panel ve RAG dağılımını analiz etme
✅ Planı onaylama veya reddetme (yorum zorunlu)
✅ Reddedilen planlar için geri bildirim sağlama
3. Finance Manager (Finans Yöneticisi)
Table
Copy
Alan	Detay
Amacı	Bütçe kontrolü ve finansal raporlama
Erişim Seviyesi	Tüm planları görüntüleme, bütçe yönetimi
Ana Ekranları	Finans Dashboard, Bütçe Yönetimi
Temel Sorumlulukları:
✅ Dönem/kanal/kategori bazında bütçe tanımlama
✅ Gerçek zamanlı bütçe kullanımını izleme
✅ Bütçe eşik değer aşımı uyarıları alma
✅ Finansal performans raporları oluşturma
4. Admin (Sistem Yöneticisi)
Table
Copy
Alan	Detay
Amacı	Sistem yapılandırması ve veri yönetimi
Erişim Seviyesi	Tam sistem erişimi
Ana Ekranları	KPI Yönetimi, Taktik Yönetimi, Kullanıcı İzinleri
Temel Sorumlulukları:
✅ Master veri yönetimi (SKU, Müşteri, FU, CPL)
✅ KPI formüllerini ve RAG eşik değerlerini yapılandırma
✅ Promosyon taktiklerini ve uygulanabilirlik kurallarını tanımlama
✅ Kullanıcı rolleri ve granüler izinleri ayarlama
🔄 İş Akışı ve Adımlar
Adım 1: Plan Oluşturma (Planner)
Copy
┌─────────────────────────────────────────┐
│  📋 YENİ PLAN OLUŞTURMA                 │
├─────────────────────────────────────────┤
│                                         │
│  1. "+Yeni Plan" butonuna tıkla         │
│                                         │
│  2. Temel Bilgileri Gir:                │
│     • Plan Adı (örn: "Yaz Süt Kampanyası")│
│     • CPL (Customer Planning Level)      │
│       → Sadece yetkili CPL'ler listelenir │
│     • Kategori (CPL seçimine göre filtre) │
│     • Başlangıç / Bitiş Tarihi           │
│                                         │
│  3. Sistem otomatik olarak:             │
│     ✓ Planı "Taslak" durumunda oluşturur │
│     ✓ Planlama Grid ekranına yönlendirir │
│                                         │
└─────────────────────────────────────────┘
Kısıtlamalar:
Plan adı: Zorunlu, max 100 karakter
CPL: Sadece kullanıcının yetkili olduğu CPL'ler
Kategori: Seçilen CPL'ye bağlı filtrelenir
Tarih aralığı: Başlangıç < Bitiş, geçmiş tarih olamaz

Adım 2: FU ve SKU Ekleme (Planner)
Copy
┌─────────────────────────────────────────┐
│  📦 ÜRÜN EKLEME (FU/SKU)                │
├─────────────────────────────────────────┤
│                                         │
│  1. "+FU Ekle" butonuna tıkla           │
│                                         │
│  2. FU Seçim Modalı:                    │
│     • Arama: FU kodu veya adı ile        │
│     • Filtreleme: Marka, Kategori        │
│     • Çoklu seçim desteği (checkbox)     │
│     • Her FU için SKU sayısı gösterilir  │
│                                         │
│  3. "Seçili FU'ları Ekle"               │
│                                         │
│  4. Sistem otomatik olarak:             │
│     ✓ FU'yu grid'e ekler (daraltılmış)   │
│     ✓ Tüm child SKU'ları yükler          │
│     ✓ Base hacimleri tarihsel veriden    │
│       otomatik doldurur                  │
│     ✓ Planlanan hacim = boş (kullanıcı   │
│       girecek)                           │
│                                         │
└─────────────────────────────────────────┘
FU (Forecasting Unit) Özellikleri:
Birden fazla SKU'yu gruplayan planlama birimi
Örnek: "Activia Yoğurt 4x100g" FU'su altında:
SKU: Çilekli 400g
SKU: Vanilyalı 400g
SKU: Yaban Mersinli 400g
SKU: Şeftalili 400g
Adım 3: Hacim Girişi - SKU Seviyesi (Planner)
Copy
┌─────────────────────────────────────────┐
│  🔢 PLANNED VOLUME GİRİŞİ (SKU Seviyesi) │
├─────────────────────────────────────────┤
│                                         │
│  Grid Yapısı:                           │
│  ┌─────────┬─────────┬─────────┐       │
│  │ FU:     │ Base    │ Planned │       │
│  │ Activia │ Vol     │ Vol     │       │
│  │ 4x100g  │ (pcs)   │ [     ] │ ← FU  │
│  ├─────────┼─────────┼─────────┤       │
│  │ ↳SKU:   │ 3,200   │ [4,200] │ ← SKU1│
│  │ Çilek   │         │         │       │
│  │ ↳SKU:   │ 2,400   │ [3,150] │ ← SKU2│
│  │ Vanilya │         │         │       │
│  └─────────┴─────────┴─────────┘       │
│                                         │
│  KURALLAR:                              │
│  • Planned Volume SADECE SKU satırında   │
│    editable (sarı arka plan)             │
│  • FU satırı otomatik toplam gösterir    │
│    (read-only, kalın font)               │
│  • Pozitif sayı zorunlu                  │
│  • Enter → kaydet ve aşağı in            │
│  • Tab → sonraki editable hücreye        │
│  • Escape → iptal et                     │
│                                         │
│  GERÇEK ZAMAN HESAPLAMA (<500ms):        │
│  ✓ Incremental Volume = Planned - Base   │
│  ✓ Volume Uplift % = Incr / Base * 100   │
│  ✓ Tüm bağımlı KPI'lar otomatik güncellenir│
│                                         │
└─────────────────────────────────────────┘
Adım 4: Promosyon Taktikleri Girişi - FU Seviyesi (Planner)
Copy
┌─────────────────────────────────────────┐
│  🎯 PROMOSYON TAKTİKLERİ (FU Seviyesi)   │
├─────────────────────────────────────────┤
│                                         │
│  GÖRÜNEN TAKTİKLER (Plan bağlamına göre):│
│                                         │
│  ON-INVOICE İNDİRİMLER:                 │
│  ┌─────────────────┬─────────┐          │
│  │ CPP On-Invoice %│ [ 10% ] │ ← FU'da  │
│  │                 │         │   editable│
│  ├─────────────────┼─────────┤          │
│  │ TPR/Drive On %  │ [  5% ] │          │
│  │ (varsa)         │         │          │
│  └─────────────────┴─────────┘          │
│                                         │
│  OFF-INVOICE İNDİRİMLER:                │
│  ┌─────────────────┬─────────┐          │
│  │ CPP Off-Invoice%│ [  5% ] │          │
│  ├─────────────────┼─────────┤          │
│  │ WS TPR Off %    │ [  -  ] │ ← Gizli  │
│  │                 │         │   (Toptan │
│  │                 │         │   kanal   │
│  │                 │         │   değil)  │
│  └─────────────────┴─────────┘          │
│                                         │
│  BİRİM BAŞINA DESTEK:                   │
│  ┌─────────────────┬─────────┐          │
│  │ Price Support   │ [$0.25] │          │
│  │ ($/birim)       │         │          │
│  └─────────────────┴─────────┘          │
│                                         │
│  LUMPSUM HARCAMALAR:                    │
│  ┌─────────────────┬─────────┐          │
│  │ Visibility      │[$2,000] │          │
│  │ MT/PH ($)       │         │          │
│  ├─────────────────┼─────────┤          │
│  │ Visibility GT   │ [  $0  ] │          │
│  │ ($)             │         │          │
│  └─────────────────┴─────────┘          │
│                                         │
│  KURALLAR:                              │
│  • Tüm taktikler SADECE FU satırında     │
│    editable                              │
│  • SKU satırları miras alınan değerleri  │
│    gri arka planda gösterir              │
│  • Min/Max validasyon (Admin tanımlı)    │
│  • Uygun olmayan taktikler otomatik      │
│    gizlenir                              │
│                                         │
└─────────────────────────────────────────┘
Taktik Dağıtım Mantığı:
Table
Copy
Taktik Tipi	Dağıtım Mantığı	Örnek
Yüzde Bazlı (CPP %, TPR %)	Aynı % tüm SKU'lara uygulanır	FU: 10% → Tüm SKU'lar: 10%
Birim Başına (Price Support)	$/birim × SKU hacmi	$0.25 × 4,200 = $1,050
Lumpsum (Visibility $)	Base hacim oranına göre dağıtılır	SKU1: %40 pay → $800
Adım 5: Gerçek Zamanlı KPI Analizi (Tüm Roller)
Copy
┌─────────────────────────────────────────┐
│  📊 GRAND TOTALS PANEL (Yapışkan Üst)    │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────┬─────────┬─────────┬────────┐│
│  │ 📦 HACİM│ 💰 CİRO │ 💸 HARCAMA│ 💎 KAR ││
│  │         │         │          │        ││
│  │125,450  │$487,320 │ $95,250   │$23,680 ││
│  │ pcs     │         │           │ iGP    ││
│  │         │         │           │        ││
│  │↑+25,450 │↑+$97,464│ ↑+$15,250 │        ││
│  │ %25.4   │ %20.0   │           │        ││
│  └─────────┴─────────┴─────────┴────────┘│
│                                         │
│  ┌─────────┬─────────────────────────┐  │
│  │ 📊 VERİM│ 🎯 GENEL DURUM          │  │
│  │         │                         │  │
│  │GP ROI:  │  ████████████████       │  │
│  │ 24.9%   │  🟢 GREEN               │  │
│  │         │  Mükemmel Performans    │  │
│  │Target:  │                         │  │
│  │ >20%    │  16🟢 | 3🟡 | 1🔴       │  │
│  │ ✓ Hedef │  Bütçe: %18.5           │  │
│  └─────────┴─────────────────────────┘  │
│                                         │
│  ÖZELLİKLER:                            │
│  • Tüm değerler gerçek zamanlı güncellenir│
│  • Değişimler yeşil/kırmızı vurgu ile    │
│  • Animasyonlu sayaç efekti              │
│  • Detay için tıklanabilir kartlar        │
│                                         │
└─────────────────────────────────────────┘
Adım 6: RAG Durum Optimizasyonu (Planner)
Copy
┌─────────────────────────────────────────┐
│  🚦 RAG (RED-AMBER-GREEN) DEĞERLENDİRMESİ │
├─────────────────────────────────────────┤
│                                         │
│  EŞİK DEĞERLER (Admin yapılandırması):   │
│  • 🟢 GREEN:  GP ROI ≥ %20               │
│  • 🟡 AMBER:  GP ROI ≥ %10 ve < %20      │
│  • 🔴 RED:    GP ROI < %10               │
│                                         │
│  GRID GÖRÜNÜMÜ:                         │
│  ┌─────────┬─────────┬─────────┐       │
│  │ FU/SKU  │ GP ROI% │ RAG     │       │
│  ├─────────┼─────────┼─────────┤       │
│  │ FU001   │ 25.6%🟢│ 🟢GREEN │       │
│  │ ↳SKU1   │ 24.4%🟢│ 🟢GREEN │       │
│  │ ↳SKU2   │ -51.3%🔴│ 🔴RED   │ ⚠️    │
│  │ ↳SKU3   │ 36.8%🟢│ 🟢GREEN │       │
│  └─────────┴─────────┴─────────┘       │
│                                         │
│  RED DURUM İŞLEMLERİ:                   │
│  • Hücre kırmızı arka plan               │
│  • Satır altında uyarı mesajı:           │
│    "⚠ Kritik: Bu SKU para kaybediyor"    │
│  • Öneriler:                             │
│    1. CPP indirimini %15'ten %10'a düşür │
│    2. Visibility harcamasını kaldır      │
│    3. Planlanan hacmi 6,000+'a çıkar     │
│                                         │
│  [Otomatik Optimize Et] [SKU'yu Kaldır]  │
│                                         │
└─────────────────────────────────────────┘
Adım 7: Planı Onaya Gönderme (Planner)
Copy
┌─────────────────────────────────────────┐
│  📤 ONAYA GÖNDERME                       │
├─────────────────────────────────────────┤
│                                         │
│  ÖN KOŞUL KONTROLLERİ:                  │
│                                         │
│  ✅ En az 1 FU eklenmiş                  │
│  ✅ Tüm validasyon hataları çözülmüş     │
│  ✅ Bütçe yetersizliği yok               │
│  ⚠️ RED öğe varsa uyarı (bloklanabilir)  │
│                                         │
│  "Onaya Gönder" butonuna tıklayınca:     │
│                                         │
│  ┌─────────────────────────────────────┐ │
│  │  Onay Gönderme Onayı                │ │
│  ├─────────────────────────────────────┤ │
│  │                                     │ │
│  │  Plan Özeti:                        │ │
│  │  • Toplam Hacim: 125,450 pcs        │ │
│  │  • Toplam Harcama: $95,250          │ │
│  │  • GP ROI: 24.9% 🟢                 │ │
│  │  • Durum: 16🟢 | 3🟡 | 1🔴          │ │
│  │                                     │ │
│  │  [Yorum ekle...]                    │ │
│  │                                     │ │
│  │  ⚠️ 1 RED öğe var. Devam etmek      │ │
│  │     istiyor musunuz?                │ │
│  │                                     │ │
│  │  [Vazgeç]  [Gönder]                 │ │
│  │                                     │ │
│  └─────────────────────────────────────┘ │
│                                         │
│  GÖNDERİM SONRASI:                      │
│  • Plan durumu: "Taslak" → "Onay Bekliyor"│
│  • Planner düzenleyemez (read-only)      │
│  • Category Manager'a bildirim gider     │
│                                         │
└─────────────────────────────────────────┘
Adım 8: Onay Süreci (Category Manager)
Copy
┌─────────────────────────────────────────┐
│  ✅ ONAY KUYRUĞU (Category Manager)      │
├─────────────────────────────────────────┤
│                                         │
│  Filtreler: [Kategori: Süt] [Tarih]     │
│                                         │
│  ┌─────────┬─────────┬─────┬────────┐  │
│  │ Plan    │ Planlayıcı│ ROI │ İşlem  │  │
│  ├─────────┼─────────┼─────┼────────┤  │
│  │Yaz Süt  │ Ahmet Y.│24.5%🟢│ [İncele]│  │
│  │Okul Dön.│ Ayşe K. │15.2%🟡│ [İncele]│  │
│  │Bayram   │ Mehmet S│ 8.5%🔴│ [İncele]│  │
│  └─────────┴─────────┴─────┴────────┘  │
│                                         │
│  DETAY MODALI (İncele tıklandığında):   │
│  ┌─────────────────────────────────────┐ │
│  │ Plan: Yaz Süt Kampanyası            │ │
│  │                                     │ │
│  │ PERFORMANS ÖZETİ (Read-Only):       │ │
│  │ • Genel Durum: 🟢 GREEN             │ │
│  │ • GP ROI: 24.9%                     │ │
│  │ • Toplam Harcama: $95,250           │ │
│  │ • Öğeler: 16🟢 | 3🟡 | 1🔴          │ │
│  │                                     │ │
│  │ [Grid Görünümü] [Yorumlar] [Geçmiş] │ │
│  │                                     │ │
│  │ Planlayıcı Yorumu:                  │ │
│  │ "Mevsimlik talep artışı için        │ │
│  │  agresif fiyatlandırma"             │ │
│  │                                     │ │
│  │ İnceleyici Yorumu:                  │ │
│  │ [________________________________]  │ │
│  │                                     │ │
│  │ [Değişiklik İste]  [Reddet]  [Onayla]│ │
│  │                                     │ │
│  └─────────────────────────────────────┘ │
│                                         │
│  ONAY SONRASI:                          │
│  • Bütçeden otomatik düşüm               │
│  • Planner'a bildirim (Onaylandı)        │
│  • Finans Dashboard'unda görünür         │
│                                         │
│  RED SONRASI:                           │
│  • Planner'a bildirim (Reddedildi + sebep)│
│  • Plan durumu: "Reddedildi"             │
│  • Planner düzenleyebilir (Taslak)       │
│                                         │
└─────────────────────────────────────────┘
🖥️ Ekran Bileşenleri Detayı
Ana Planlama Ekranı Yapısı
Copy
┌─────────────────────────────────────────────────────────────┐
│  🔷 HEADER (80px - Sabit)                                    │
│  [← Plan Listesi]  PLAN DETAYI  [💬][🔔][⚙]                 │
│  "Yaz Süt Kampanyası - Carrefour" [✏️ Yeniden Adlandır]      │
│  CPL: Carrefour CPL | Kategori: Süt | 1 Haz - 30 Haz 2025    │
│  Durum: [●●● TASLAK] Son kayıt: 2 dk önce | Sahip: Ahmet Y.  │
│  [💾 Taslağı Kaydet] [📤 Onaya Gönder] [📋 Kopyala] [🗑 Sil] │
├─────────────────────────────────────────────────────────────┤
│  📊 GRAND TOTALS PANEL (140px - Yapışkan)                    │
│  [6 metrik kartı - yukarıda detaylandırıldı]                 │
├─────────────────────────────────────────────────────────────┤
│  🔧 TOOLBAR (60px - Yapışkan)                                │
│  [+FU Ekle] [📥 İçe Aktar] [📋 Şablonlar] |                  │
│  Görünüm: [Tüm Sütunlar ▼] [Sütunları Özelleştir] [📊] [📁] │
│  Göster: [✓Tümü] [🔍 FU Ara...] RAG: [✓G] [✓A] [✓R]        │
│  [💾] [↻ Yenile]                                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │  📋 ANA PLANLAMA GRIDI (Kaydırılabilir)              │    │
│  │                                                      │    │
│  │  [Sabit Sol] [Kaydırılabilir KPI'lar] [Sabit Sağ]   │    │
│  │                                                      │    │
│  │  [+]│FU001│Activia 4x100g│8,000│[10,500]│+2,500│...│25.6%│🟢│ │
│  │   ↳│SKU01│Çilek 400g    │3,200│[ 4,200]│+1,000│...│24.4%│🟢│ │
│  │   ↳│SKU02│Vanilya 400g  │2,400│[ 3,150]│+  750│...│36.8%│🟢│ │
│  │   ↳│SKU03│Yaban Mersini │1,600│[ 2,100]│+  500│...│18.5%│🟡│ │
│  │   ↳│SKU04│Şeftali 400g  │  800│[ 1,050]│+  250│...│-51.3%│🔴│⚠│
│  │                                                      │    │
│  │  [+]│FU002│Greek Yoğurt 200g│...                      │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  💬 YORUMLAR & AKTİVİTE PANELİ (320px - Daraltılabilir Sağ)  │
│  [Kullanıcı yorumları ve değişiklik geçmişi]                 │
└─────────────────────────────────────────────────────────────┘
⚙️ Teknik Özellikler
Table
Copy
Özellik	Hedef
Sayfa Yükleme	< 2 saniye
KPI Hesaplama	< 500 ms
Grid Render	< 1 saniye (50 FU, 200+ SKU)
Otomatik Kaydet	2 saniye debounce
Eş Zamanlı Kullanıcı	100 kullanıcı
Maksimum Plan Boyutu	500+ SKU, 50+ FU

🎨 Kullanıcı Deneyimi Özellikleri
Table
Copy
Özellik	Açıklama
Inline Düzenleme	Hücreye tıkla → doğrudan düzenle
Klavye Navigasyonu	Tab, Enter, Escape, Ok tuşları
Toplu Düzenleme	Çoklu seçim + kopyala/yapıştır
Excel Entegrasyonu	Excel'den kopyala/grid'e yapıştır
Sürükle-Bırak	Sütun yeniden sıralama, genişlik ayarı
Animasyonlu Geri Bildirim	Değişimlerde yeşil/kırmızı vurgu
Bağlam Yardımı	Her hücrede bilgi ikonu + açıklama
Geri/İleri Al	Ctrl+Z / Ctrl+Y desteği
