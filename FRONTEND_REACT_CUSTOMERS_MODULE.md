# Frontend React.js - Customers Modülü

## Genel Bakış

Customers modülü, müşteri yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Müşteri oluşturma, güncelleme, silme, arama, filtreleme ve toplu import işlemlerini kapsar.

## Endpoint'ler

### POST `/customers`
**Açıklama:** Yeni müşteri oluşturma (ADMIN, PLANNER rolleri gerekli)

**Request Body:**
```typescript
{
  code: string;                    // Zorunlu, min 1, max 50 karakter
  name: string;                    // Zorunlu, min 2, max 200 karakter
  channel: 'NKA' | 'TRADITIONAL_TRADE' | 'E_COMMERCE' | 'EXPORT' | 'WHOLESALE' | 'RETAIL' | 'HORECA';  // Zorunlu
  type?: 'DIRECT' | 'DISTRIBUTOR' | 'WHOLESALER' | 'RETAILER' | 'END_CUSTOMER';
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  taxNumber?: string;
  taxOffice?: string;
  companyRegistrationNumber?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMobile?: string;
  paymentTerms?: string;
  creditLimit?: number;
  currency?: string;              // Default: 'TRY'
  salesRepresentative?: string;
  accountManager?: string;
  customerGroup?: string;
  customerSegment?: string;
  customerTier?: string;
  businessSize?: string;
  annualRevenue?: number;
  numberOfBranches?: number;
  isVip?: boolean;                // Default: false
  notes?: string;
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  code: string;
  name: string;
  channel: string;
  type: string;
  status: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Çalışma Mantığı:**
1. Kullanıcı müşteri formunu doldurur
2. Form validasyonu yapılır (code, name, channel zorunlu)
3. Backend'e istek gönderilir
4. Başarılıysa müşteri oluşturulur ve detay sayfasına yönlendirilir
5. Hata durumunda kullanıcıya bilgi verilir

**Frontend Kullanım Senaryosu:**
- Müşteri yönetimi sayfasında "Yeni Müşteri" butonu
- Form modal veya ayrı sayfa
- Çok adımlı form (temel bilgiler, iletişim, finansal bilgiler)
- Form validasyonu ve hata yönetimi

---

### POST `/customers/bulk`
**Açıklama:** Toplu müşteri oluşturma (ADMIN, PLANNER rolleri gerekli)

**Request Body:**
```typescript
{
  customers: CreateCustomerDto[];
}
```

**Response (201 Created):** Oluşturulan müşteri dizisi

**Çalışma Mantığı:**
1. Kullanıcı birden fazla müşteri bilgisini hazırlar
2. Toplu oluşturma endpoint'ine gönderilir
3. Tüm müşteriler oluşturulur
4. Başarılı/başarısız sonuçlar gösterilir

**Frontend Kullanım Senaryosu:**
- Toplu müşteri ekleme sayfası
- JSON veya form tablosu ile veri girişi
- Toplu validasyon ve hata gösterimi

---

### GET `/customers`
**Açıklama:** Tüm müşterileri listeleme (filtreleme ve arama ile)

**Query Parameters:**
```typescript
{
  search?: string;                // Ad, kod, iletişim bilgilerinde arama
  channel?: 'NKA' | 'TRADITIONAL_TRADE' | 'E_COMMERCE' | 'EXPORT' | 'WHOLESALE' | 'RETAIL' | 'HORECA';
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';
  city?: string;
  isVip?: boolean;
  page?: number;                  // Default: 1
  limit?: number;                 // Default: 10
  sortBy?: string;                // Default: 'name'
  sortOrder?: 'ASC' | 'DESC';     // Default: 'ASC'
}
```

**Response (200 OK):**
```typescript
Array<{
  id: string;
  code: string;
  name: string;
  channel: string;
  status: string;
  city?: string;
  numberOfBranches?: number;
  isVip: boolean;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
}>
```

**Çalışma Mantığı:**
1. Müşteri listesi sayfası açıldığında çağrılır
2. Filtreler ve arama terimi query parametrelerine eklenir
3. Backend filtrelenmiş sonuçları döner
4. Tablo formatında gösterilir
5. Pagination uygulanır

**Frontend Kullanım Senaryosu:**
- Müşteri listesi sayfası
- Filtreleme paneli (channel, status, city, vip)
- Arama kutusu
- Sıralama özelliği
- Pagination
- Her satırda detay/düzenleme/silme butonları

---

### GET `/customers/search?q=metro`
**Açıklama:** Müşteri arama

**Query Parameters:**
```typescript
{
  q: string;  // Arama terimi
}
```

**Response (200 OK):** Eşleşen müşteri dizisi

**Çalışma Mantığı:**
1. Kullanıcı arama kutusuna metin girer
2. Debounce ile arama yapılır (300ms gecikme)
3. Backend'e arama isteği gönderilir
4. Sonuçlar dropdown veya liste olarak gösterilir

**Frontend Kullanım Senaryosu:**
- Header'da global arama
- Müşteri seçim dropdown'larında
- Autocomplete özelliği
- Sonuçların highlight edilmesi

---

### GET `/customers/channel/:channel`
**Açıklama:** Kanal bazında müşteri listeleme

**Response (200 OK):** Belirtilen kanaldaki müşteri dizisi

**Çalışma Mantığı:**
1. Kanal filtresi seçildiğinde çağrılır
2. İlgili kanaldaki müşteriler listelenir

**Frontend Kullanım Senaryosu:**
- Kanal bazlı filtreleme
- Dashboard'da kanal istatistikleri

---

### GET `/customers/city/:city`
**Açıklama:** Şehir bazında müşteri listeleme

**Response (200 OK):** Belirtilen şehirdeki müşteri dizisi

**Çalışma Mantığı:**
1. Şehir filtresi seçildiğinde çağrılır
2. İlgili şehirdeki müşteriler listelenir

**Frontend Kullanım Senaryosu:**
- Şehir bazlı filtreleme
- Harita görünümü için veri

---

### GET `/customers/vip`
**Açıklama:** VIP müşterileri listeleme

**Response (200 OK):** VIP müşteri dizisi

**Çalışma Mantığı:**
1. VIP müşteri filtresi seçildiğinde çağrılır
2. VIP müşteriler listelenir

**Frontend Kullanım Senaryosu:**
- VIP müşteri listesi
- Dashboard'da VIP müşteri kartı

---

### GET `/customers/:id`
**Açıklama:** Belirli bir müşterinin detaylarını getirme

**Response (200 OK):**
```typescript
{
  id: string;
  code: string;
  name: string;
  channel: string;
  type: string;
  status: string;
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  address?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMobile?: string;
  numberOfBranches?: number;
  isVip: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Hata Yanıtları:**
- `404 Not Found`: Müşteri bulunamadı

**Çalışma Mantığı:**
1. Müşteri detay sayfası açıldığında çağrılır
2. Müşteri bilgileri gösterilir
3. İlgili anlaşmalar, bütçe rezervasyonları gösterilebilir

**Frontend Kullanım Senaryosu:**
- Müşteri detay sayfası
- Müşteri kartı görünümü
- İlgili verilerin gösterimi (anlaşmalar, işlemler)

---

### GET `/customers/code/:code`
**Açıklama:** Müşteri koduna göre müşteri getirme

**Response (200 OK):** Müşteri objesi

**Çalışma Mantığı:**
1. Müşteri kodu ile arama yapılır
2. Müşteri bulunursa detayları döner

**Frontend Kullanım Senaryosu:**
- Müşteri kodu ile hızlı arama
- Form validasyonu (kod tekrarı kontrolü)

---

### PATCH `/customers/:id`
**Açıklama:** Müşteri bilgilerini güncelleme (ADMIN, PLANNER rolleri gerekli)

**Request Body:** Partial CreateCustomerDto

**Response (200 OK):** Güncellenmiş müşteri objesi

**Çalışma Mantığı:**
1. Müşteri düzenleme formu açılır
2. Mevcut bilgilerle doldurulur
3. Güncellemeler yapılır ve submit edilir
4. Backend'e güncelleme isteği gönderilir
5. Başarılıysa müşteri bilgileri güncellenir

**Frontend Kullanım Senaryosu:**
- Müşteri düzenleme sayfası
- Form validasyonu
- Değişiklik takibi (dirty state)

---

### DELETE `/customers/:id`
**Açıklama:** Müşteri silme (ADMIN, PLANNER rolleri gerekli)

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Müşteri silme butonuna tıklanır
2. Onay modalı gösterilir
3. Onaylandığında silme isteği gönderilir
4. Müşteri silinir ve listeden kaldırılır

**Frontend Kullanım Senaryosu:**
- Müşteri listesinde silme butonu
- Kritik işlem onay modalı
- Başarı mesajı ve liste güncelleme

---

### POST `/customers/:id/activate`
**Açıklama:** Müşteriyi aktif etme (ADMIN, PLANNER rolleri gerekli)

**Response (200 OK):** Aktif edilmiş müşteri objesi

**Çalışma Mantığı:**
1. Müşteri durum değiştirme butonuna tıklanır
2. Müşteri durumu ACTIVE olur

**Frontend Kullanım Senaryosu:**
- Müşteri listesinde durum toggle butonu
- Hızlı durum değiştirme

---

### POST `/customers/:id/deactivate`
**Açıklama:** Müşteriyi pasif etme (ADMIN, PLANNER rolleri gerekli)

**Response (200 OK):** Pasif edilmiş müşteri objesi

**Çalışma Mantığı:**
1. Müşteri durum değiştirme butonuna tıklanır
2. Müşteri durumu INACTIVE olur

**Frontend Kullanım Senaryosu:**
- Müşteri listesinde durum toggle butonu
- Onay modalı (kritik işlem)

---

### GET `/customers/:id/stats`
**Açıklama:** Müşteri istatistiklerini getirme

**Response (200 OK):**
```typescript
{
  totalOrders?: number;
  totalRevenue?: number;
  lastOrderDate?: string;
  averageOrderValue?: number;
}
```

**Çalışma Mantığı:**
1. Müşteri detay sayfasında istatistikler gösterilir
2. Dashboard kartları için veri sağlar

**Frontend Kullanım Senaryosu:**
- Müşteri detay sayfasında istatistik kartları
- Dashboard'da müşteri özeti

---

### POST `/customers/import`
**Açıklama:** Excel/CSV dosyasından müşteri import etme (ADMIN, PLANNER rolleri gerekli)

**Content-Type:** `multipart/form-data`

**Request:** Form data with `file` field

**Response (201 Created):**
```typescript
{
  total: number;              // Toplam işlenen satır
  created: number;            // Oluşturulan müşteri sayısı
  skipped: number;            // Atlanan müşteri sayısı
  errors: Array<{
    row: number;              // Satır numarası
    code: string;              // Müşteri kodu
    error_type: 'MISSING_FIELD' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'ALREADY_EXISTS' | 'DUPLICATE_IN_FILE' | 'DATABASE_ERROR' | 'INVALID_EMAIL';
    error_message: string;    // Hata mesajı
    original_row_data: object; // Orijinal satır verisi
  }>;
}
```

**Hata Tipleri:**
- `MISSING_FIELD`: Zorunlu alan eksik
- `INVALID_DATE`: Geçersiz tarih formatı
- `INVALID_AMOUNT`: Geçersiz sayısal değer
- `ALREADY_EXISTS`: Müşteri kodu zaten mevcut
- `DUPLICATE_IN_FILE`: Dosyada tekrar eden kod
- `DATABASE_ERROR`: Veritabanı hatası
- `INVALID_EMAIL`: Geçersiz email formatı

**Çalışma Mantığı:**
1. Kullanıcı Excel/CSV dosyası seçer
2. Dosya validasyonu yapılır (format, boyut)
3. FormData ile backend'e gönderilir
4. Backend dosyayı işler ve sonuçları döner
5. Başarılı/başarısız sonuçlar gösterilir
6. Hata detayları tablo formatında gösterilir

**Frontend Kullanım Senaryosu:**
- Müşteri import sayfası
- Dosya seçme (drag & drop veya file picker)
- Dosya validasyonu (format, boyut - max 10MB)
- Import progress göstergesi
- Sonuç özeti (başarılı/başarısız sayıları)
- Hata detayları tablosu
- Hatalı satırları düzeltme ve tekrar import

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      customers.service.ts
  hooks/
    useCustomers.ts
    useCustomer.ts
    useCustomerImport.ts
  components/
    customers/
      CustomerList.tsx
      CustomerForm.tsx
      CustomerDetail.tsx
      CustomerFilters.tsx
      CustomerImport.tsx
      CustomerImportResults.tsx
  pages/
    customers/
      CustomersPage.tsx
      CustomerDetailPage.tsx
      CustomerCreatePage.tsx
      CustomerImportPage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  customers: {
    list: Customer[];
    selectedCustomer: Customer | null;
    isLoading: boolean;
    error: string | null;
    filters: {
      search?: string;
      channel?: string;
      status?: string;
      city?: string;
      isVip?: boolean;
    };
    pagination: {
      page: number;
      limit: number;
      total: number;
    };
    importResult: {
      total: number;
      created: number;
      skipped: number;
      errors: ImportError[];
    } | null;
  }
}
```

**Actions:**
- `fetchCustomers`: Müşteri listesini getir
- `fetchCustomerById`: Belirli müşteriyi getir
- `searchCustomers`: Müşteri ara
- `createCustomer`: Yeni müşteri oluştur
- `updateCustomer`: Müşteri güncelle
- `deleteCustomer`: Müşteri sil
- `activateCustomer`: Müşteriyi aktif et
- `deactivateCustomer`: Müşteriyi pasif et
- `importCustomers`: Müşteri import et
- `setFilters`: Filtreleri ayarla
- `clearFilters`: Filtreleri temizle

### React Hook Kullanımı

**useCustomers Hook:**
```typescript
const {
  customers,
  isLoading,
  error,
  filters,
  pagination,
  fetchCustomers,
  searchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  setFilters,
  clearFilters
} = useCustomers();
```

**useCustomer Hook:**
```typescript
const {
  customer,
  isLoading,
  error,
  fetchCustomer,
  updateCustomer,
  activateCustomer,
  deactivateCustomer
} = useCustomer(customerId);
```

**useCustomerImport Hook:**
```typescript
const {
  importResult,
  isImporting,
  error,
  importCustomers,
  clearResult
} = useCustomerImport();
```

### Form Yönetimi

**Müşteri Oluşturma Formu:**
- Çok adımlı form (Stepper)
  - Adım 1: Temel Bilgiler (code, name, channel, type)
  - Adım 2: İletişim Bilgileri (adres, telefon, email)
  - Adım 3: Finansal Bilgiler (creditLimit, paymentTerms)
  - Adım 4: Ek Bilgiler (notes, isVip)
- Form validasyonu
- Kod tekrarı kontrolü (real-time)
- Email format kontrolü

**Müşteri Düzenleme Formu:**
- Mevcut bilgilerle doldurulmuş form
- Değişiklik takibi
- Kaydetme onayı

**Import Formu:**
- Dosya seçme
- Dosya önizleme
- Template indirme
- Import sonuçları gösterimi

---

## Kullanım Senaryoları

### Senaryo 1: Müşteri Listesi Görüntüleme
1. Kullanıcı müşteri yönetimi sayfasına gider
2. `GET /customers` çağrılır (varsayılan filtrelerle)
3. Müşteriler tablo formatında listelenir
4. Filtreleme ve arama yapılabilir
5. Pagination ile sayfa geçişi

### Senaryo 2: Müşteri Arama
1. Kullanıcı arama kutusuna metin girer
2. Debounce ile `GET /customers/search?q=...` çağrılır
3. Sonuçlar anlık olarak güncellenir
4. Sonuçlar highlight edilir

### Senaryo 3: Yeni Müşteri Oluşturma
1. Kullanıcı "Yeni Müşteri" butonuna tıklar
2. Çok adımlı form açılır
3. Her adımda validasyon yapılır
4. Son adımda `POST /customers` çağrılır
5. Başarılıysa müşteri detay sayfasına yönlendirilir

### Senaryo 4: Müşteri Import
1. Kullanıcı "Müşteri Import" sayfasına gider
2. Excel/CSV dosyası seçer
3. Dosya validasyonu yapılır
4. `POST /customers/import` çağrılır
5. Import sonuçları gösterilir
6. Hatalı satırlar düzeltilip tekrar import edilebilir

### Senaryo 5: Müşteri Filtreleme
1. Kullanıcı filtre panelini açar
2. Channel, status, city, vip filtreleri seçilir
3. `GET /customers` çağrılır (filtrelerle)
4. Filtrelenmiş sonuçlar gösterilir
5. Filtreler URL'de saklanır (bookmark için)

### Senaryo 6: Müşteri Detay Görüntüleme
1. Kullanıcı müşteri listesinden bir müşteriye tıklar
2. `GET /customers/:id` çağrılır
3. Müşteri detayları gösterilir
4. İlgili anlaşmalar ve işlemler gösterilir
5. `GET /customers/:id/stats` ile istatistikler gösterilir

---

## UI/UX Önerileri

### Müşteri Listesi
- Tablo formatında gösterim
- Sıralama özelliği (ad, kod, kanal, durum)
- Filtreleme paneli (yan panel veya üst bar)
- Arama kutusu (header'da)
- Pagination (alt kısımda)
- Toplu işlemler (seçili müşterileri aktif/pasif et)
- Export özelliği (Excel/CSV)

### Müşteri Formu
- Çok adımlı form (Stepper component)
- Form validasyonu (her adımda)
- Kaydetme ve iptal butonları
- Progress göstergesi
- Auto-save (draft olarak kaydetme)

### Müşteri Import
- Drag & drop dosya yükleme
- Dosya önizleme
- Template indirme butonu
- Import progress bar
- Sonuç özeti kartları
- Hata detayları tablosu (sıralanabilir, filtrelenebilir)
- Hatalı satırları düzeltme ve tekrar import

### Müşteri Detay
- Kart görünümü
- Tab yapısı (Genel Bilgiler, İletişim, Finansal, İstatistikler, İşlemler)
- Düzenleme butonu
- Durum badge'i
- VIP badge'i
- İlgili veriler (anlaşmalar, bütçe rezervasyonları)

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN ve PLANNER rolleri müşteri oluşturabilir, silebilir
   - Diğer roller sadece görüntüleyebilir

2. **Dosya Import Güvenliği:**
   - Dosya boyutu kontrolü (max 10MB)
   - Dosya format kontrolü (.xlsx, .xls, .csv)
   - MIME type kontrolü
   - XSS koruması (dosya içeriği sanitize edilmeli)

3. **Form Validasyonu:**
   - Kod tekrarı kontrolü (real-time)
   - Email format kontrolü
   - Telefon format kontrolü
   - Zorunlu alan kontrolü

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Geçersiz form verisi
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Müşteri bulunamadı
- `409 Conflict`: Müşteri kodu zaten mevcut
- `413 Payload Too Large`: Dosya boyutu çok büyük

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Form validasyon hataları form alanlarında gösterilmeli
- Import hataları detaylı tablo formatında gösterilmeli
- Network hataları için retry mekanizması

---

## Özet

Customers modülü, müşteri yönetiminin tüm işlevlerini kapsar. Müşteri oluşturma, düzenleme, silme, arama, filtreleme ve toplu import işlemleri yapılabilir. Gelişmiş filtreleme ve arama özellikleri ile kullanıcı deneyimi optimize edilmiştir.

**Önemli Endpoint'ler:**
- `POST /customers` - Müşteri oluşturma
- `GET /customers` - Müşteri listesi (filtreleme ile)
- `GET /customers/search` - Müşteri arama
- `GET /customers/:id` - Müşteri detayı
- `PATCH /customers/:id` - Müşteri güncelleme
- `DELETE /customers/:id` - Müşteri silme
- `POST /customers/import` - Müşteri import
- `GET /customers/:id/stats` - Müşteri istatistikleri

**Frontend Gereksinimleri:**
- Müşteri listesi komponenti (filtreleme, arama, pagination)
- Müşteri formu komponenti (çok adımlı)
- Müşteri detay sayfası
- Müşteri import komponenti
- State management (Redux)
- Form validasyonu
- Dosya yükleme ve işleme
