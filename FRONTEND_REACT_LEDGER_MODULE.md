# Frontend React.js - Ledger Modülü

## Genel Bakış

Ledger modülü, muhasebe defteri (ledger) yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Defter kayıtlarını listeleme, anlaşma veya bütçe zarfı bazında filtreleme ve tüketilen tutarları görüntüleme işlemlerini kapsar. Bu modül, finansal işlemlerin takibi için kullanılır.

## Endpoint'ler

### GET `/ledger`
**Açıklama:** Tüm defter kayıtlarını listeleme (ADMIN, FINANCE, PLANNER rolleri gerekli)

**Query Parameters:**
```typescript
{
  agreementId?: string;              // Anlaşma ID ile filtreleme
  budgetEnvelopeId?: string;        // Bütçe zarfı ID ile filtreleme
  periodMonth?: string;              // Dönem ayı ile filtreleme (YYYY-MM formatı)
  spendType?: string;               // Harcama tipi ile filtreleme
}
```

**Response (200 OK):**
```typescript
Array<{
  id: string;
  agreementId: string;
  budgetEnvelopeId: string;
  periodMonth: string;              // YYYY-MM formatı
  spendType: 'OFF_INVOICE' | 'ON_INVOICE' | 'OTHER';
  amount: number;
  currency: string;
  description?: string;
  metadata?: object;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}>
```

**Çalışma Mantığı:**
1. Defter kayıtları sayfası açıldığında çağrılır
2. Filtreler query parametrelerine eklenir
3. Backend filtrelenmiş sonuçları döner
4. Tablo formatında gösterilir

**Frontend Kullanım Senaryosu:**
- Defter kayıtları listesi sayfası
- Filtreleme paneli (anlaşma, bütçe zarfı, dönem, harcama tipi)
- Sıralama özelliği
- Pagination
- Export özelliği (Excel/CSV)

---

### GET `/ledger/agreement/:agreementId`
**Açıklama:** Belirli bir anlaşmaya ait defter kayıtlarını getirme (ADMIN, FINANCE, PLANNER rolleri gerekli)

**Response (200 OK):** Anlaşmaya ait defter kayıtları dizisi

**Çalışma Mantığı:**
1. Anlaşma detay sayfasında defter kayıtları gösterilir
2. Anlaşmaya ait tüm işlemler listelenir
3. Toplam tüketilen tutar hesaplanabilir

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında defter kayıtları sekmesi
- İşlem geçmişi tablosu
- Toplam tüketilen tutar gösterimi

---

### GET `/ledger/agreement/:agreementId/consumed`
**Açıklama:** Anlaşma için toplam tüketilen tutarı getirme (ADMIN, FINANCE, PLANNER rolleri gerekli)

**Response (200 OK):**
```typescript
{
  agreementId: string;
  consumed: number;                  // Toplam tüketilen tutar
}
```

**Çalışma Mantığı:**
1. Anlaşma detay sayfasında toplam tüketilen tutar gösterilir
2. Tüm defter kayıtları toplanır
3. Toplam tutar döner

**Frontend Kullanım Senaryosu:**
- Anlaşma detay sayfasında tüketilen tutar kartı
- Bütçe karşılaştırması (tahsis edilen vs. tüketilen)
- Progress bar

---

### GET `/ledger/envelope/:envelopeId`
**Açıklama:** Belirli bir bütçe zarfına ait defter kayıtlarını getirme (ADMIN, FINANCE rolleri gerekli)

**Response (200 OK):** Bütçe zarfına ait defter kayıtları dizisi

**Çalışma Mantığı:**
1. Bütçe zarfı detay sayfasında defter kayıtları gösterilir
2. Bütçe zarfına ait tüm işlemler listelenir
3. Toplam tüketilen tutar hesaplanabilir

**Frontend Kullanım Senaryosu:**
- Bütçe zarfı detay sayfasında defter kayıtları sekmesi
- İşlem geçmişi tablosu
- Toplam tüketilen tutar gösterimi

---

### GET `/ledger/envelope/:envelopeId/consumed`
**Açıklama:** Bütçe zarfı için toplam tüketilen tutarı getirme (ADMIN, FINANCE rolleri gerekli)

**Response (200 OK):**
```typescript
{
  envelopeId: string;
  consumed: number;                  // Toplam tüketilen tutar
}
```

**Çalışma Mantığı:**
1. Bütçe zarfı detay sayfasında toplam tüketilen tutar gösterilir
2. Tüm defter kayıtları toplanır
3. Toplam tutar döner

**Frontend Kullanım Senaryosu:**
- Bütçe zarfı detay sayfasında tüketilen tutar kartı
- Bütçe karşılaştırması (tahsis edilen vs. tüketilen)
- Progress bar

---

### GET `/ledger/:id`
**Açıklama:** Belirli bir defter kaydının detaylarını getirme (ADMIN, FINANCE, PLANNER rolleri gerekli)

**Response (200 OK):** Defter kaydı objesi (tüm detaylar)

**Hata Yanıtları:**
- `404 Not Found`: Defter kaydı bulunamadı

**Çalışma Mantığı:**
1. Defter kaydı detay sayfası açıldığında çağrılır
2. Defter kaydı bilgileri gösterilir
3. İlgili anlaşma ve bütçe zarfı bilgileri gösterilebilir

**Frontend Kullanım Senaryosu:**
- Defter kaydı detay sayfası
- Defter kaydı bilgileri kartı
- İlgili varlık bilgileri (anlaşma, bütçe zarfı)

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      ledger.service.ts
  hooks/
    useLedger.ts
    useLedgerByAgreement.ts
    useLedgerByEnvelope.ts
  components/
    ledger/
      LedgerList.tsx
      LedgerItem.tsx
      LedgerFilters.tsx
      ConsumedAmountCard.tsx
      LedgerDetail.tsx
  pages/
    ledger/
      LedgerPage.tsx
      LedgerDetailPage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  ledger: {
    entries: LedgerEntry[];
    selectedEntry: LedgerEntry | null;
    consumedByAgreement: Record<string, number>;  // agreementId -> consumed
    consumedByEnvelope: Record<string, number>;    // envelopeId -> consumed
    isLoading: boolean;
    error: string | null;
    filters: {
      agreementId?: string;
      budgetEnvelopeId?: string;
      periodMonth?: string;
      spendType?: string;
    };
  }
}
```

**Actions:**
- `fetchLedgerEntries`: Defter kayıtlarını getir
- `fetchLedgerByAgreement`: Anlaşmaya ait kayıtları getir
- `fetchLedgerByEnvelope`: Bütçe zarfına ait kayıtları getir
- `fetchConsumedByAgreement`: Anlaşma için tüketilen tutarı getir
- `fetchConsumedByEnvelope`: Bütçe zarfı için tüketilen tutarı getir
- `fetchLedgerEntryById`: Belirli kaydı getir
- `setFilters`: Filtreleri ayarla

### React Hook Kullanımı

**useLedger Hook:**
```typescript
const {
  entries,
  isLoading,
  error,
  filters,
  fetchLedgerEntries,
  setFilters
} = useLedger();
```

**useLedgerByAgreement Hook:**
```typescript
const {
  entries,
  consumed,
  isLoading,
  error,
  fetchLedgerByAgreement,
  fetchConsumed
} = useLedgerByAgreement(agreementId);
```

**useLedgerByEnvelope Hook:**
```typescript
const {
  entries,
  consumed,
  isLoading,
  error,
  fetchLedgerByEnvelope,
  fetchConsumed
} = useLedgerByEnvelope(envelopeId);
```

---

## Kullanım Senaryoları

### Senaryo 1: Defter Kayıtlarını Listeleme
1. Kullanıcı defter kayıtları sayfasına gider
2. `GET /ledger` çağrılır (varsayılan filtrelerle)
3. Defter kayıtları tablo formatında listelenir
4. Filtreleme ve arama yapılabilir
5. Pagination ile sayfa geçişi

### Senaryo 2: Anlaşmaya Ait Defter Kayıtları
1. Kullanıcı anlaşma detay sayfasına gider
2. "Defter Kayıtları" sekmesine tıklar
3. `GET /ledger/agreement/:agreementId` çağrılır
4. Anlaşmaya ait işlemler listelenir
5. `GET /ledger/agreement/:agreementId/consumed` ile toplam tüketilen tutar gösterilir

### Senaryo 3: Bütçe Zarfına Ait Defter Kayıtları
1. Kullanıcı bütçe zarfı detay sayfasına gider
2. "Defter Kayıtları" sekmesine tıklar
3. `GET /ledger/envelope/:envelopeId` çağrılır
4. Bütçe zarfına ait işlemler listelenir
5. `GET /ledger/envelope/:envelopeId/consumed` ile toplam tüketilen tutar gösterilir

### Senaryo 4: Tüketilen Tutar Görüntüleme
1. Anlaşma veya bütçe zarfı detay sayfasında
2. Tüketilen tutar kartı gösterilir
3. Tahsis edilen tutar ile karşılaştırma yapılır
4. Progress bar ile görselleştirme

### Senaryo 5: Defter Kaydı Detayı
1. Kullanıcı defter kayıtları listesinden bir kaydı seçer
2. `GET /ledger/:id` çağrılır
3. Defter kaydı detayları gösterilir
4. İlgili anlaşma ve bütçe zarfı bilgileri gösterilir

---

## UI/UX Önerileri

### Defter Kayıtları Listesi
- Tablo formatında gösterim
- Sıralama özelliği (tarih, tutar, anlaşma)
- Filtreleme paneli (anlaşma, bütçe zarfı, dönem, harcama tipi)
- Pagination
- Export butonu (Excel/CSV)
- Toplam tutar gösterimi (filtrelenmiş sonuçlar için)

### Defter Kaydı Kartı
- Anlaşma bilgisi (link)
- Bütçe zarfı bilgisi (link)
- Dönem bilgisi
- Tutar (formatlanmış, renkli)
- Harcama tipi badge'i
- Tarih bilgisi
- Açıklama

### Tüketilen Tutar Kartı
- Toplam tüketilen tutar
- Tahsis edilen tutar
- Kalan tutar
- Progress bar (tüketim oranı)
- Yüzde gösterimi
- Uyarı (bütçe aşımı durumunda)

### Filtreleme Paneli
- Anlaşma seçimi (autocomplete)
- Bütçe zarfı seçimi (autocomplete)
- Dönem seçimi (ay/yıl picker)
- Harcama tipi seçimi (dropdown)
- Filtreleri temizle butonu
- Filtreleri kaydet (bookmark için)

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN, FINANCE ve PLANNER rolleri defter kayıtlarını görebilir
   - FINANCE rolü tüm kayıtları görebilir
   - PLANNER rolü sadece kendi anlaşmalarına ait kayıtları görebilir

2. **Veri Gizliliği:**
   - Hassas finansal bilgiler sadece yetkili kullanıcılara gösterilmeli
   - Export işlemleri log'lanmalı

3. **Filtreleme:**
   - Kullanıcı sadece yetkili olduğu verileri görebilmeli
   - Backend'de filtreleme yapılmalı

---

## Hata Yönetimi

**Hata Tipleri:**
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Defter kaydı bulunamadı
- `500 Internal Server Error`: Sunucu hatası

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Network hataları için retry mekanizması
- Veri yüklenemezse kullanıcıya bilgi verilmeli

---

## Özet

Ledger modülü, muhasebe defteri yönetiminin tüm işlevlerini kapsar. Defter kayıtları listelenebilir, anlaşma veya bütçe zarfı bazında filtrelenebilir ve tüketilen tutarlar görüntülenebilir. Bu modül, finansal işlemlerin takibi ve raporlama için kritik öneme sahiptir.

**Önemli Endpoint'ler:**
- `GET /ledger` - Defter kayıtları listesi
- `GET /ledger/agreement/:agreementId` - Anlaşmaya ait kayıtlar
- `GET /ledger/agreement/:agreementId/consumed` - Anlaşma için tüketilen tutar
- `GET /ledger/envelope/:envelopeId` - Bütçe zarfına ait kayıtlar
- `GET /ledger/envelope/:envelopeId/consumed` - Bütçe zarfı için tüketilen tutar
- `GET /ledger/:id` - Defter kaydı detayı

**Frontend Gereksinimleri:**
- Defter kayıtları listesi komponenti
- Defter kaydı detay sayfası
- Filtreleme paneli
- Tüketilen tutar kartları
- Progress bar (bütçe kullanımı)
- Export özelliği
- State management (Redux)
- Anlaşma ve bütçe zarfı entegrasyonu
