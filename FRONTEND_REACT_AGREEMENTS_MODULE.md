# Frontend React.js - Agreements Modülü

## Genel Bakış

Agreements modülü, anlaşma yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Anlaşma oluşturma, güncelleme, onaylama, reddetme, iptal etme ve silme işlemlerini kapsar. Anlaşmalar state machine ile yönetilir ve durum geçişleri kontrollü şekilde yapılır.

## Endpoint'ler

### POST `/agreements`
**Açıklama:** Yeni anlaşma oluşturma (ADMIN, PLANNER rolleri gerekli)

**Request Body:**
```typescript
{
  agreementName?: string;            // Opsiyonel, max 200 karakter
  agreementType: 'STA' | 'LTA';      // Zorunlu, STA (≤30 gün) veya LTA (>30 gün)
  cplId: string;                     // Zorunlu, Müşteri ID (UUID)
  channel: string;                    // Zorunlu, Kanal
  regionId?: string;                 // Opsiyonel, Bölge ID (UUID)
  fuId: string;                       // Zorunlu, Forecasting Unit ID (UUID)
  guId?: string;                     // Opsiyonel, Generic Unit ID (UUID)
  skuScope?: string;                  // Opsiyonel, 'GU', 'FU', 'SKU', 'ALL', default: 'FU'
  tacticId: string;                   // Zorunlu, Taktik ID (UUID)
  mechanicId: string;                 // Zorunlu, Mekanik ID (UUID)
  mechanicValue?: number;             // Opsiyonel, Mekanik değeri (örn: 15.00 TL veya 10.5%)
  mechanicType?: 'FIXED' | 'PERCENTAGE';
  capTotalAmount: number;             // Zorunlu, Bütçe tavanı (min 0.01)
  spendType?: 'OFF_INVOICE' | 'ON_INVOICE' | 'OTHER';
  startDate: string;                  // Zorunlu, Başlangıç tarihi (YYYY-MM-DD)
  endDate: string;                    // Zorunlu, Bitiş tarihi (YYYY-MM-DD)
  justification: string;              // Zorunlu, İş gerekçesi
  currency?: string;                  // Opsiyonel, Para birimi, default: 'TRY'
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  agreementNumber: string;            // Otomatik oluşturulan numara (örn: STA-2026-025)
  agreementName?: string;
  agreementType: string;
  status: 'DRAFT';                   // Başlangıç durumu
  cplId: string;
  channel: string;
  capTotalAmount: number;
  startDate: string;
  endDate: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Çalışma Mantığı:**
1. Planner veya Admin yeni anlaşma formunu doldurur
2. Form validasyonu yapılır (zorunlu alanlar kontrol edilir)
3. Backend'e istek gönderilir
4. Backend anlaşma numarası oluşturur (örn: STA-2026-025)
5. Anlaşma DRAFT durumunda oluşturulur
6. Başarılıysa anlaşma detay sayfasına yönlendirilir

**Frontend Kullanım Senaryosu:**
- Anlaşma yönetimi sayfasında "Yeni Anlaşma" butonu
- Çok adımlı form (Temel Bilgiler, Müşteri Seçimi, Bütçe, Tarihler, Gerekçe)
- Form validasyonu
- Müşteri seçimi (autocomplete veya dropdown)
- Tarih seçici (başlangıç ve bitiş tarihleri)
- Bütçe tavanı input (formatlanmış)

---

### GET `/agreements`
**Açıklama:** Tüm anlaşmaları listeleme (filtreleme ile)

**Query Parameters:**
```typescript
{
  status?: 'DRAFT' | 'PENDING' | 'APPROVED' | 'ACTIVE' | 'REJECTED' | 'CANCELLED';
  cplId?: string;                    // Müşteri ID ile filtreleme
  channel?: string;                  // Kanal ile filtreleme
}
```

**Response (200 OK):**
```typescript
Array<{
  id: string;
  agreementNumber: string;
  agreementName?: string;
  agreementType: string;
  status: string;
  cplId: string;
  channel: string;
  capTotalAmount: number;
  startDate: string;
  endDate: string;
  createdAt: Date;
}>
```

**Çalışma Mantığı:**
1. Anlaşma listesi sayfası açıldığında çağrılır
2. Filtreler query parametrelerine eklenir
3. Backend filtrelenmiş sonuçları döner
4. Tablo formatında gösterilir

**Frontend Kullanım Senaryosu:**
- Anlaşma listesi sayfası
- Filtreleme paneli (durum, müşteri, kanal)
- Sıralama özelliği
- Pagination
- Her satırda detay/onay/red/iptal butonları (duruma göre)

---

### GET `/agreements/:id`
**Açıklama:** Belirli bir anlaşmanın detaylarını getirme

**Response (200 OK):** Anlaşma objesi (tüm detaylar)

**Hata Yanıtları:**
- `404 Not Found`: Anlaşma bulunamadı

**Çalışma Mantığı:**
1. Anlaşma detay sayfası açıldığında çağrılır
2. Anlaşma bilgileri gösterilir
3. Durum geçiş butonları gösterilir (duruma göre)
4. İlgili bütçe rezervasyonları gösterilebilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfası
- Anlaşma bilgileri kartı
- Durum badge'i
- Durum geçiş butonları (Submit, Approve, Reject, Cancel)
- İlgili veriler (bütçe rezervasyonu, işlemler)

---

### PATCH `/agreements/:id`
**Açıklama:** Anlaşma güncelleme (Sadece DRAFT durumundaki anlaşmalar güncellenebilir) (ADMIN, PLANNER rolleri gerekli)

**Request Body:** Partial CreateAgreementDto

**Response (200 OK):** Güncellenmiş anlaşma objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece DRAFT anlaşmalar düzenlenebilir

**Çalışma Mantığı:**
1. Anlaşma düzenleme formu açılır
2. Sadece DRAFT durumundaki anlaşmalar düzenlenebilir
3. Mevcut bilgilerle form doldurulur
4. Güncellemeler yapılır ve submit edilir
5. Backend'e güncelleme isteği gönderilir

**Frontend Kullanım Senaryosu:**
- Anlaşma düzenleme sayfası
- Sadece DRAFT durumunda düzenleme butonu gösterilir
- Form validasyonu
- Değişiklik takibi

---

### POST `/agreements/:id/submit`
**Açıklama:** Anlaşmayı onay için gönderme (Sadece DRAFT durumundaki anlaşmalar gönderilebilir) (ADMIN, PLANNER rolleri gerekli)

**Response (200 OK):** Durumu PENDING olan anlaşma objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece DRAFT anlaşmalar gönderilebilir

**Çalışma Mantığı:**
1. Planner anlaşmayı onay için gönderir
2. Anlaşma durumu DRAFT'tan PENDING'e geçer
3. Onay isteği oluşturulur
4. İlgili onaylayıcılara bildirim gönderilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında "Onay İçin Gönder" butonu
- Onay modalı (onay mesajı)
- Başarı mesajı
- Durum güncellemesi

---

### POST `/agreements/:id/approve`
**Açıklama:** Anlaşmayı onaylama (Sadece PENDING durumundaki anlaşmalar onaylanabilir) (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Request Body:**
```typescript
{
  comments?: string;                 // Opsiyonel, onay yorumu
}
```

**Response (200 OK):** Durumu APPROVED olan anlaşma objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece PENDING anlaşmalar onaylanabilir

**Çalışma Mantığı:**
1. Approver veya Finance anlaşmayı onaylar
2. Anlaşma durumu PENDING'den APPROVED'e geçer
3. Bütçe rezervasyonu otomatik olarak yapılır (POST /budget/reserve)
4. Anlaşma sahibine bildirim gönderilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında "Onayla" butonu
- Onay modalı (yorum eklenebilir)
- Bütçe rezervasyonu durumu gösterimi
- Başarı mesajı

---

### POST `/agreements/:id/reject`
**Açıklama:** Anlaşmayı reddetme (Sadece PENDING durumundaki anlaşmalar reddedilebilir) (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Request Body:**
```typescript
{
  reason: string;                    // Zorunlu, red nedeni
}
```

**Response (200 OK):** Durumu REJECTED olan anlaşma objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece PENDING anlaşmalar reddedilebilir

**Çalışma Mantığı:**
1. Approver veya Finance anlaşmayı reddeder
2. Anlaşma durumu PENDING'den REJECTED'e geçer
3. Red nedeni kaydedilir
4. Anlaşma sahibine bildirim gönderilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında "Reddet" butonu
- Red modalı (red nedeni zorunlu)
- Başarı mesajı

---

### POST `/agreements/:id/cancel`
**Açıklama:** Anlaşmayı iptal etme (Sadece APPROVED veya ACTIVE durumundaki anlaşmalar iptal edilebilir, rezerve edilmiş bütçe serbest bırakılır) (ADMIN, PLANNER rolleri gerekli)

**Request Body:**
```typescript
{
  reason: string;                    // Zorunlu, iptal nedeni
}
```

**Response (200 OK):** Durumu CANCELLED olan anlaşma objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece APPROVED veya ACTIVE anlaşmalar iptal edilebilir

**Çalışma Mantığı:**
1. Planner veya Admin anlaşmayı iptal eder
2. Anlaşma durumu CANCELLED'e geçer
3. Rezerve edilmiş bütçe serbest bırakılır (RELEASE transaction)
4. İptal nedeni kaydedilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında "İptal Et" butonu
- İptal modalı (iptal nedeni zorunlu)
- Bütçe serbest bırakma uyarısı
- Başarı mesajı

---

### DELETE `/agreements/:id`
**Açıklama:** Anlaşmayı silme (Sadece DRAFT durumundaki anlaşmalar silinebilir) (ADMIN, PLANNER rolleri gerekli)

**Response:** `204 No Content`

**Hata Yanıtları:**
- `400 Bad Request`: Sadece DRAFT anlaşmalar silinebilir

**Çalışma Mantığı:**
1. Planner veya Admin anlaşma silme butonuna tıklar
2. Onay modalı gösterilir
3. Onaylandığında silme isteği gönderilir
4. Anlaşma silinir

**Frontend Kullanım Senaryosu:**
- Anlaşma listesinde veya detay sayfasında silme butonu
- Sadece DRAFT durumunda gösterilir
- Onay modalı
- Başarı mesajı

---

## Anlaşma Durum Makinesi (State Machine)

**Durumlar:**
- `DRAFT`: Taslak - Düzenlenebilir, silinebilir
- `PENDING`: Beklemede - Onay bekliyor
- `APPROVED`: Onaylandı - Bütçe rezerve edildi
- `ACTIVE`: Aktif - Çalışıyor
- `REJECTED`: Reddedildi - Red nedeni ile reddedildi
- `CANCELLED`: İptal edildi - Bütçe serbest bırakıldı

**Durum Geçişleri:**
- `DRAFT` → `PENDING`: Submit (Planner/Admin)
- `PENDING` → `APPROVED`: Approve (Approver/Finance/Admin)
- `PENDING` → `REJECTED`: Reject (Approver/Finance/Admin)
- `APPROVED` → `ACTIVE`: Otomatik (sistem)
- `APPROVED` → `CANCELLED`: Cancel (Planner/Admin)
- `ACTIVE` → `CANCELLED`: Cancel (Planner/Admin)

**Durum Bazlı İşlemler:**
- **DRAFT**: Düzenle, Sil, Gönder
- **PENDING**: Onayla, Reddet, İptal Et (sadece oluşturan)
- **APPROVED**: İptal Et
- **ACTIVE**: İptal Et
- **REJECTED**: (Yeni anlaşma oluştur)
- **CANCELLED**: (Yeni anlaşma oluştur)

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      agreements.service.ts
  hooks/
    useAgreements.ts
    useAgreement.ts
  components/
    agreements/
      AgreementList.tsx
      AgreementForm.tsx
      AgreementDetail.tsx
      AgreementStatusBadge.tsx
      AgreementActions.tsx
      AgreementStateMachine.tsx
  pages/
    agreements/
      AgreementsPage.tsx
      AgreementDetailPage.tsx
      AgreementCreatePage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  agreements: {
    list: Agreement[];
    selectedAgreement: Agreement | null;
    isLoading: boolean;
    error: string | null;
    filters: {
      status?: string;
      cplId?: string;
      channel?: string;
    };
  }
}
```

**Actions:**
- `fetchAgreements`: Anlaşma listesini getir
- `fetchAgreementById`: Belirli anlaşmayı getir
- `createAgreement`: Yeni anlaşma oluştur
- `updateAgreement`: Anlaşma güncelle
- `submitAgreement`: Anlaşmayı gönder
- `approveAgreement`: Anlaşmayı onayla
- `rejectAgreement`: Anlaşmayı reddet
- `cancelAgreement`: Anlaşmayı iptal et
- `deleteAgreement`: Anlaşmayı sil
- `setFilters`: Filtreleri ayarla

### React Hook Kullanımı

**useAgreements Hook:**
```typescript
const {
  agreements,
  isLoading,
  error,
  filters,
  fetchAgreements,
  createAgreement,
  setFilters
} = useAgreements();
```

**useAgreement Hook:**
```typescript
const {
  agreement,
  isLoading,
  error,
  fetchAgreement,
  updateAgreement,
  submitAgreement,
  approveAgreement,
  rejectAgreement,
  cancelAgreement,
  deleteAgreement,
  canEdit,
  canSubmit,
  canApprove,
  canReject,
  canCancel,
  canDelete
} = useAgreement(agreementId);
```

### Form Yönetimi

**Anlaşma Oluşturma Formu:**
- Çok adımlı form (Stepper)
  - Adım 1: Temel Bilgiler (agreementName, agreementType, channel)
  - Adım 2: Müşteri Seçimi (cplId)
  - Adım 3: Ürün/Unit Seçimi (fuId, guId, skuScope)
  - Adım 4: Taktik ve Mekanik (tacticId, mechanicId, mechanicValue)
  - Adım 5: Bütçe ve Tarihler (capTotalAmount, startDate, endDate)
  - Adım 6: Gerekçe (justification)
- Form validasyonu
- Müşteri seçimi (autocomplete)
- Tarih seçici (başlangıç ve bitiş)
- Bütçe input (formatlanmış)

---

## Kullanım Senaryoları

### Senaryo 1: Yeni Anlaşma Oluşturma
1. Planner "Yeni Anlaşma" butonuna tıklar
2. Çok adımlı form açılır
3. Her adımda validasyon yapılır
4. Son adımda `POST /agreements` çağrılır
5. Başarılıysa anlaşma DRAFT durumunda oluşturulur
6. Anlaşma detay sayfasına yönlendirilir

### Senaryo 2: Anlaşmayı Onay İçin Gönderme
1. Planner anlaşma detay sayfasında "Onay İçin Gönder" butonuna tıklar
2. Onay modalı gösterilir
3. `POST /agreements/:id/submit` çağrılır
4. Anlaşma durumu PENDING'e geçer
5. Onaylayıcılara bildirim gönderilir

### Senaryo 3: Anlaşmayı Onaylama
1. Approver anlaşma listesinde PENDING anlaşmaları görür
2. Anlaşma detay sayfasına gider
3. "Onayla" butonuna tıklar
4. Onay modalı açılır (yorum eklenebilir)
5. `POST /agreements/:id/approve` çağrılır
6. Anlaşma durumu APPROVED'e geçer
7. Bütçe rezervasyonu otomatik yapılır
8. Planner'a bildirim gönderilir

### Senaryo 4: Anlaşmayı Reddetme
1. Approver anlaşma detay sayfasında "Reddet" butonuna tıklar
2. Red modalı açılır (red nedeni zorunlu)
3. `POST /agreements/:id/reject` çağrılır
4. Anlaşma durumu REJECTED'e geçer
5. Planner'a bildirim gönderilir

### Senaryo 5: Anlaşmayı İptal Etme
1. Planner anlaşma detay sayfasında "İptal Et" butonuna tıklar
2. İptal modalı açılır (iptal nedeni zorunlu)
3. Bütçe serbest bırakma uyarısı gösterilir
4. `POST /agreements/:id/cancel` çağrılır
5. Anlaşma durumu CANCELLED'e geçer
6. Rezerve edilmiş bütçe serbest bırakılır

---

## UI/UX Önerileri

### Anlaşma Listesi
- Tablo formatında gösterim
- Durum badge'leri (renkli)
- Sıralama özelliği
- Filtreleme (durum, müşteri, kanal)
- Pagination
- Durum bazlı aksiyon butonları

### Anlaşma Formu
- Çok adımlı form (Stepper)
- Form validasyonu (her adımda)
- Kaydetme ve iptal butonları
- Progress göstergesi
- Auto-save (draft olarak kaydetme)

### Anlaşma Detay
- Kart görünümü
- Durum badge'i
- Durum geçiş butonları (duruma göre)
- Durum geçmişi timeline
- İlgili veriler (bütçe rezervasyonu, işlemler)
- Yorumlar ve notlar

### Durum Geçişleri
- Durum makinesi görselleştirmesi
- Geçerli durum geçişleri gösterimi
- Butonlar sadece geçerli işlemler için aktif
- Onay/Red/İptal modalları
- Başarı/hata mesajları

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN ve PLANNER rolleri anlaşma oluşturabilir
   - Sadece ADMIN, APPROVER ve FINANCE rolleri onaylayabilir/reddedebilir
   - Sadece ADMIN ve PLANNER rolleri iptal edebilir

2. **Durum Kontrolü:**
   - Sadece DRAFT anlaşmalar düzenlenebilir
   - Sadece PENDING anlaşmalar onaylanabilir/reddedilebilir
   - Sadece APPROVED veya ACTIVE anlaşmalar iptal edilebilir
   - Frontend'de durum kontrolü yapılmalı (UX için)

3. **Bütçe Rezervasyonu:**
   - Anlaşma onaylandığında otomatik bütçe rezervasyonu yapılır
   - Yetersiz bütçe durumunda onay engellenir
   - İptal edildiğinde rezerve edilmiş bütçe serbest bırakılır

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Geçersiz durum geçişi veya form verisi
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Anlaşma bulunamadı

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Durum geçiş hataları için özel mesajlar
- Form validasyon hataları form alanlarında gösterilmeli
- Network hataları için retry mekanizması

---

## Özet

Agreements modülü, anlaşma yönetiminin tüm işlevlerini kapsar. Anlaşma oluşturma, düzenleme, onaylama, reddetme, iptal etme ve silme işlemleri yapılabilir. State machine ile durum geçişleri kontrollü şekilde yönetilir.

**Önemli Endpoint'ler:**
- `POST /agreements` - Anlaşma oluşturma
- `GET /agreements` - Anlaşma listesi
- `GET /agreements/:id` - Anlaşma detayı
- `PATCH /agreements/:id` - Anlaşma güncelleme (DRAFT)
- `POST /agreements/:id/submit` - Onay için gönderme
- `POST /agreements/:id/approve` - Anlaşmayı onaylama
- `POST /agreements/:id/reject` - Anlaşmayı reddetme
- `POST /agreements/:id/cancel` - Anlaşmayı iptal etme
- `DELETE /agreements/:id` - Anlaşmayı silme (DRAFT)

**Frontend Gereksinimleri:**
- Anlaşma listesi komponenti
- Anlaşma formu komponenti (çok adımlı)
- Anlaşma detay sayfası
- Durum makinesi görselleştirmesi
- Durum geçiş butonları
- Onay/Red/İptal modalları
- State management (Redux)
- Form validasyonu
- Durum bazlı işlem kontrolü
