# Frontend React.js - Budget Modülü

## Genel Bakış

Budget modülü, bütçe yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Bütçe zarfı (envelope) oluşturma, bütçe rezervasyonu, rezerve edilmiş tutar görüntüleme ve işlem geçmişi işlemlerini kapsar. Event-sourced mimari kullanılarak bütçe rezervasyonları transaction olarak kaydedilir.

## Endpoint'ler

### POST `/budget/envelopes`
**Açıklama:** Yeni bütçe zarfı oluşturma (ADMIN, FINANCE rolleri gerekli)

**Request Body:**
```typescript
{
  code: string;                    // Zorunlu, örn: "NKA/Hair/Jan"
  name: string;                    // Zorunlu
  fiscalYear: string;               // Zorunlu, örn: "2024"
  period: string;                   // Zorunlu, örn: "Jan"
  allocatedAmount: number;           // Zorunlu, tahsis edilen tutar
  status?: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  budgetOwnerId?: string;
  budgetOwnerEmail?: string;
  budgetOwnerName?: string;
  currency?: string;                // Default: 'TRY'
  description?: string;
  metadata?: object;
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  code: string;
  name: string;
  fiscalYear: string;
  period: string;
  allocatedAmount: number;
  consumedAmount: number;           // Tüketilen tutar (başlangıçta 0)
  availableAmount: number;           // Kullanılabilir tutar
  status: string;
  currency: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Çalışma Mantığı:**
1. Finance veya Admin yeni bütçe zarfı formunu doldurur
2. Form validasyonu yapılır (code, name, allocatedAmount zorunlu)
3. Backend'e istek gönderilir
4. Başarılıysa bütçe zarfı oluşturulur
5. Bütçe zarfı listesine eklenir

**Frontend Kullanım Senaryosu:**
- Bütçe yönetimi sayfasında "Yeni Bütçe Zarfı" butonu
- Form modal veya ayrı sayfa
- Code formatı: "KANAL/KATEGORI/DONEM" (örn: "NKA/Hair/Jan")
- Tutar validasyonu (pozitif sayı)

---

### GET `/budget/envelopes`
**Açıklama:** Tüm bütçe zarflarını listeleme

**Response (200 OK):**
```typescript
Array<{
  id: string;
  code: string;
  name: string;
  fiscalYear: string;
  period: string;
  allocatedAmount: number;
  consumedAmount: number;
  availableAmount: number;
  status: string;
  currency: string;
  createdAt: Date;
}>
```

**Çalışma Mantığı:**
1. Bütçe zarfları listesi sayfası açıldığında çağrılır
2. Tüm bütçe zarfları gösterilir
3. Her zarf için tahsis edilen, tüketilen ve kullanılabilir tutarlar gösterilir

**Frontend Kullanım Senaryosu:**
- Bütçe zarfları listesi sayfası
- Tablo formatında gösterim
- Sıralama ve filtreleme
- Durum badge'leri
- Tutar gösterimi (formatlanmış)

---

### GET `/budget/envelopes/:id`
**Açıklama:** Belirli bir bütçe zarfının detaylarını getirme

**Response (200 OK):** Bütçe zarfı objesi

**Çalışma Mantığı:**
1. Bütçe zarfı detay sayfası açıldığında çağrılır
2. Bütçe zarfı bilgileri gösterilir
3. Rezerve edilmiş tutar ve işlem geçmişi gösterilebilir

**Frontend Kullanım Senaryosu:**
- Bütçe zarfı detay sayfası
- Bütçe zarfı bilgileri kartı
- Tutar özeti (tahsis edilen, rezerve, tüketilen, kullanılabilir)
- İşlem geçmişi tablosu

---

### POST `/budget/reserve`
**Açıklama:** Bütçe rezervasyonu yapma (Event-sourced: RESERVE transaction oluşturur) (PLANNER, ADMIN rolleri gerekli)

**Request Body:**
```typescript
{
  envelopeId: string;               // Zorunlu
  agreementId: string;               // Zorunlu
  amount: number;                    // Zorunlu, rezerve edilecek tutar
  currency?: string;                  // Default: 'TRY'
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  envelopeId: string;
  txType: 'RESERVE';
  txStatus: 'POSTED';
  sourceType: 'AGREEMENT';
  sourceId: string;                  // agreementId
  amount: number;
  currency: string;
  idempotencyKey: string;            // Tekrar işlem önleme anahtarı
  description: string;
  createdAt: Date;
}
```

**Hata Yanıtları:**
- `400 Bad Request`: Yetersiz bütçe veya geçersiz istek
- `404 Not Found`: Bütçe zarfı bulunamadı
- `409 Conflict`: Rezervasyon zaten mevcut (idempotency)

**Çalışma Mantığı:**
1. Anlaşma onaylandığında bütçe rezervasyonu yapılır
2. Backend mevcut bütçeyi kontrol eder
3. Yeterli bütçe varsa RESERVE transaction oluşturulur
4. Rezervasyon başarılı olur
5. Bütçe zarfındaki kullanılabilir tutar güncellenir

**Frontend Kullanım Senaryosu:**
- Anlaşma onaylandığında otomatik çağrılır
- Bütçe rezervasyonu modalı
- Yetersiz bütçe uyarısı
- Başarı/hata mesajları

---

### GET `/budget/envelopes/:id/reserved`
**Açıklama:** Bütçe zarfı için rezerve edilmiş tutarı getirme (transaction'lardan hesaplanır)

**Response (200 OK):**
```typescript
{
  envelopeId: string;
  reservedAmount: number;
}
```

**Çalışma Mantığı:**
1. Bütçe zarfı detay sayfasında rezerve edilmiş tutar gösterilir
2. Backend tüm RESERVE transaction'larını toplar
3. Toplam rezerve edilmiş tutar döner

**Frontend Kullanım Senaryosu:**
- Bütçe zarfı detay sayfasında
- Bütçe özeti kartında
- Rezerve edilmiş tutar gösterimi

---

### GET `/budget/envelopes/:id/transactions`
**Açıklama:** Bütçe zarfı için tüm işlemleri getirme

**Response (200 OK):**
```typescript
Array<{
  id: string;
  txType: 'RESERVE' | 'CONSUME' | 'RELEASE' | 'ADJUST';
  txStatus: 'POSTED' | 'PENDING' | 'CANCELLED';
  sourceType: 'AGREEMENT' | 'MANUAL' | 'SYSTEM';
  sourceId: string;
  amount: number;
  currency: string;
  description: string;
  createdAt: Date;
}>
```

**Çalışma Mantığı:**
1. Bütçe zarfı detay sayfasında işlem geçmişi gösterilir
2. Tüm transaction'lar listelenir
3. Filtreleme ve sıralama yapılabilir

**Frontend Kullanım Senaryosu:**
- Bütçe zarfı detay sayfasında işlem geçmişi tablosu
- Transaction tipi badge'leri
- Sıralama ve filtreleme
- Detay görüntüleme

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      budget.service.ts
  hooks/
    useBudgetEnvelopes.ts
    useBudgetEnvelope.ts
    useBudgetReservation.ts
  components/
    budget/
      BudgetEnvelopeList.tsx
      BudgetEnvelopeForm.tsx
      BudgetEnvelopeDetail.tsx
      BudgetReservationModal.tsx
      BudgetSummaryCard.tsx
      BudgetTransactionsTable.tsx
  pages/
    budget/
      BudgetEnvelopesPage.tsx
      BudgetEnvelopeDetailPage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  budget: {
    envelopes: BudgetEnvelope[];
    selectedEnvelope: BudgetEnvelope | null;
    reservedAmounts: Record<string, number>;  // envelopeId -> reservedAmount
    transactions: BudgetTransaction[];
    isLoading: boolean;
    error: string | null;
  }
}
```

**Actions:**
- `fetchEnvelopes`: Bütçe zarflarını getir
- `fetchEnvelopeById`: Belirli bütçe zarfını getir
- `createEnvelope`: Yeni bütçe zarfı oluştur
- `reserveBudget`: Bütçe rezervasyonu yap
- `fetchReservedAmount`: Rezerve edilmiş tutarı getir
- `fetchTransactions`: İşlem geçmişini getir

### React Hook Kullanımı

**useBudgetEnvelopes Hook:**
```typescript
const {
  envelopes,
  isLoading,
  error,
  fetchEnvelopes,
  createEnvelope
} = useBudgetEnvelopes();
```

**useBudgetEnvelope Hook:**
```typescript
const {
  envelope,
  reservedAmount,
  transactions,
  isLoading,
  error,
  fetchEnvelope,
  fetchReservedAmount,
  fetchTransactions
} = useBudgetEnvelope(envelopeId);
```

**useBudgetReservation Hook:**
```typescript
const {
  reserveBudget,
  isReserving,
  error
} = useBudgetReservation();
```

### Bütçe Hesaplamaları

**Kullanılabilir Tutar Hesaplama:**
```typescript
const availableAmount = allocatedAmount - reservedAmount - consumedAmount;
```

**Bütçe Durumu:**
- `AVAILABLE`: Kullanılabilir tutar > 0
- `RESERVED`: Rezerve edilmiş tutar > 0
- `CONSUMED`: Tüketilen tutar > 0
- `OVER_BUDGET`: Kullanılabilir tutar < 0

---

## Kullanım Senaryoları

### Senaryo 1: Bütçe Zarfı Oluşturma
1. Finance veya Admin "Yeni Bütçe Zarfı" butonuna tıklar
2. Form doldurulur (code, name, allocatedAmount)
3. `POST /budget/envelopes` çağrılır
4. Başarılıysa bütçe zarfı oluşturulur
5. Liste güncellenir

### Senaryo 2: Bütçe Zarfları Listesi
1. Kullanıcı bütçe yönetimi sayfasına gider
2. `GET /budget/envelopes` çağrılır
3. Tüm bütçe zarfları listelenir
4. Her zarf için tutar özeti gösterilir

### Senaryo 3: Bütçe Rezervasyonu
1. Anlaşma onaylandığında otomatik olarak çağrılır
2. `POST /budget/reserve` çağrılır
3. Backend bütçe kontrolü yapar
4. Yeterli bütçe varsa rezervasyon yapılır
5. Yetersiz bütçe varsa hata mesajı gösterilir

### Senaryo 4: Bütçe Zarfı Detayı
1. Kullanıcı bütçe zarfı listesinden bir zarfı seçer
2. `GET /budget/envelopes/:id` çağrılır
3. `GET /budget/envelopes/:id/reserved` çağrılır
4. `GET /budget/envelopes/:id/transactions` çağrılır
5. Tüm bilgiler gösterilir

### Senaryo 5: Bütçe Özeti Görüntüleme
1. Dashboard'da bütçe özeti gösterilir
2. Tüm zarflar için toplam tutarlar hesaplanır
3. Grafikler ve görselleştirmeler gösterilir

---

## UI/UX Önerileri

### Bütçe Zarfları Listesi
- Tablo formatında gösterim
- Sıralama özelliği (kod, tutar, durum)
- Filtreleme (durum, dönem, yıl)
- Tutar gösterimi (formatlanmış, renkli)
- Durum badge'leri
- Progress bar (tüketim oranı)

### Bütçe Zarfı Formu
- Modal veya ayrı sayfa
- Form validasyonu
- Code formatı örneği
- Tutar input (formatlanmış)
- Loading state
- Error handling

### Bütçe Zarfı Detay
- Kart görünümü
- Tutar özeti kartları (tahsis edilen, rezerve, tüketilen, kullanılabilir)
- Progress bar
- İşlem geçmişi tablosu
- Filtreleme ve sıralama

### Bütçe Rezervasyonu
- Modal dialog
- Anlaşma bilgileri
- Rezerve edilecek tutar
- Mevcut bütçe kontrolü
- Yetersiz bütçe uyarısı
- Başarı/hata mesajları

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN ve FINANCE rolleri bütçe zarfı oluşturabilir
   - Sadece PLANNER ve ADMIN rolleri bütçe rezervasyonu yapabilir
   - Tüm roller bütçe zarflarını görüntüleyebilir

2. **Bütçe Kontrolü:**
   - Rezervasyon yapılmadan önce bütçe kontrolü yapılmalı
   - Yetersiz bütçe durumunda kullanıcıya uyarı gösterilmeli
   - Frontend'de de kontrol yapılabilir (UX için)

3. **Idempotency:**
   - Aynı rezervasyon tekrar yapılmamalı
   - Backend idempotency key ile kontrol eder
   - Frontend'de de kontrol yapılabilir

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Yetersiz bütçe veya geçersiz istek
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Bütçe zarfı bulunamadı
- `409 Conflict`: Rezervasyon zaten mevcut

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Yetersiz bütçe durumunda özel uyarı
- Network hataları için retry mekanizması

---

## Özet

Budget modülü, bütçe yönetiminin tüm işlevlerini kapsar. Bütçe zarfları oluşturulabilir, bütçe rezervasyonu yapılabilir ve işlem geçmişi görüntülenebilir. Event-sourced mimari sayesinde tüm işlemler transaction olarak kaydedilir.

**Önemli Endpoint'ler:**
- `POST /budget/envelopes` - Bütçe zarfı oluşturma
- `GET /budget/envelopes` - Bütçe zarfları listesi
- `GET /budget/envelopes/:id` - Bütçe zarfı detayı
- `POST /budget/reserve` - Bütçe rezervasyonu
- `GET /budget/envelopes/:id/reserved` - Rezerve edilmiş tutar
- `GET /budget/envelopes/:id/transactions` - İşlem geçmişi

**Frontend Gereksinimleri:**
- Bütçe zarfları listesi komponenti
- Bütçe zarfı formu komponenti
- Bütçe zarfı detay sayfası
- Bütçe rezervasyonu modalı
- Bütçe özeti kartları
- İşlem geçmişi tablosu
- State management (Redux)
- Form validasyonu
- Bütçe hesaplamaları
