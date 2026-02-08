# Frontend React.js - Approvals Modülü

## Genel Bakış

Approvals modülü, onay yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Onay isteklerini listeleme, onaylama, reddetme ve iptal etme işlemlerini kapsar. Bu modül, anlaşmalar ve diğer varlıklar için onay süreçlerini yönetir.

## Endpoint'ler

### GET `/approvals`
**Açıklama:** Tüm onay isteklerini listeleme (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Query Parameters:**
```typescript
{
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestType?: string;             // İstek tipi
  entityType?: string;              // Varlık tipi (örn: 'AGREEMENT')
}
```

**Response (200 OK):**
```typescript
Array<{
  id: string;
  requestType: string;
  entityType: string;
  entityId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedBy: string;             // Kullanıcı ID
  requestedByName?: string;
  requestedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  comments?: string;
  rejectionReason?: string;
  metadata?: object;
  createdAt: Date;
  updatedAt: Date;
}>
```

**Çalışma Mantığı:**
1. Onay yönetimi sayfası açıldığında çağrılır
2. Filtreler query parametrelerine eklenir
3. Backend filtrelenmiş sonuçları döner
4. Tablo formatında gösterilir

**Frontend Kullanım Senaryosu:**
- Onay yönetimi sayfası
- Filtreleme paneli (durum, tip, varlık tipi)
- Sıralama özelliği
- Pagination
- Her satırda detay/onay/red butonları

---

### GET `/approvals/pending`
**Açıklama:** Mevcut kullanıcı için bekleyen onay isteklerini getirme (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Response (200 OK):** Bekleyen onay istekleri dizisi

**Çalışma Mantığı:**
1. Dashboard veya onay panelinde çağrılır
2. Sadece mevcut kullanıcıya atanmış PENDING istekler döner
3. Bildirim sayısı için kullanılabilir

**Frontend Kullanım Senaryosu:**
- Dashboard'da bekleyen onaylar kartı
- Header'da onay bildirimi
- Onay paneli
- Hızlı onay/red işlemleri

---

### GET `/approvals/my-requests`
**Açıklama:** Mevcut kullanıcının oluşturduğu onay isteklerini getirme

**Response (200 OK):** Kullanıcının oluşturduğu onay istekleri dizisi

**Çalışma Mantığı:**
1. "Benim İsteklerim" sayfasında çağrılır
2. Kullanıcının oluşturduğu tüm istekler listelenir
3. Durum takibi yapılabilir

**Frontend Kullanım Senaryosu:**
- "Benim İsteklerim" sayfası
- İstek durumu takibi
- İptal etme butonu (PENDING istekler için)

---

### GET `/approvals/:id`
**Açıklama:** Belirli bir onay isteğinin detaylarını getirme

**Response (200 OK):** Onay isteği objesi (tüm detaylar)

**Hata Yanıtları:**
- `404 Not Found`: Onay isteği bulunamadı

**Çalışma Mantığı:**
1. Onay isteği detay sayfası açıldığında çağrılır
2. Onay isteği bilgileri gösterilir
3. İlgili varlık (anlaşma vb.) bilgileri gösterilebilir
4. Onay/Red butonları gösterilir (PENDING ise)

**Frontend Kullanım Senaryosu:**
- Onay isteği detay sayfası
- İlgili varlık bilgileri (anlaşma detayı)
- Onay/Red butonları
- Durum geçmişi

---

### POST `/approvals/:id/approve`
**Açıklama:** Onay isteğini onaylama (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Request Body:**
```typescript
{
  comments?: string;                // Opsiyonel, onay yorumu
}
```

**Response (200 OK):** Onaylanmış onay isteği objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece PENDING istekler onaylanabilir
- `403 Forbidden`: Kullanıcının bu isteği onaylama yetkisi yok

**Çalışma Mantığı:**
1. Approver onay butonuna tıklar
2. Onay modalı açılır (yorum eklenebilir)
3. `POST /approvals/:id/approve` çağrılır
4. Onay isteği durumu APPROVED'e geçer
5. İlgili varlık (anlaşma) onaylanır
6. İstek sahibine bildirim gönderilir

**Frontend Kullanım Senaryosu:**
- Onay isteği detay sayfasında "Onayla" butonu
- Onay modalı (yorum eklenebilir)
- Başarı mesajı
- Durum güncellemesi

---

### POST `/approvals/:id/reject`
**Açıklama:** Onay isteğini reddetme (ADMIN, APPROVER, FINANCE rolleri gerekli)

**Request Body:**
```typescript
{
  reason: string;                   // Zorunlu, red nedeni
}
```

**Response (200 OK):** Reddedilmiş onay isteği objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece PENDING istekler reddedilebilir
- `403 Forbidden`: Kullanıcının bu isteği reddetme yetkisi yok

**Çalışma Mantığı:**
1. Approver red butonuna tıklar
2. Red modalı açılır (red nedeni zorunlu)
3. `POST /approvals/:id/reject` çağrılır
4. Onay isteği durumu REJECTED'e geçer
5. İlgili varlık (anlaşma) reddedilir
6. İstek sahibine bildirim gönderilir

**Frontend Kullanım Senaryosu:**
- Onay isteği detay sayfasında "Reddet" butonu
- Red modalı (red nedeni zorunlu)
- Başarı mesajı
- Durum güncellemesi

---

### POST `/approvals/:id/cancel`
**Açıklama:** Bekleyen onay isteğini iptal etme (Sadece isteği oluşturan kullanıcı) (ADMIN, PLANNER rolleri gerekli)

**Response (200 OK):** İptal edilmiş onay isteği objesi

**Hata Yanıtları:**
- `400 Bad Request`: Sadece PENDING istekler iptal edilebilir
- `403 Forbidden`: Sadece isteği oluşturan kullanıcı iptal edebilir

**Çalışma Mantığı:**
1. İstek sahibi iptal butonuna tıklar
2. Onay modalı gösterilir
3. `POST /approvals/:id/cancel` çağrılır
4. Onay isteği durumu CANCELLED'e geçer
5. İlgili varlık (anlaşma) DRAFT durumuna döner

**Frontend Kullanım Senaryosu:**
- "Benim İsteklerim" sayfasında iptal butonu
- Sadece PENDING istekler için gösterilir
- Onay modalı
- Başarı mesajı

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      approvals.service.ts
  hooks/
    useApprovals.ts
    useApproval.ts
    usePendingApprovals.ts
  components/
    approvals/
      ApprovalList.tsx
      ApprovalDetail.tsx
      ApprovalActions.tsx
      ApprovalCard.tsx
      PendingApprovalsWidget.tsx
  pages/
    approvals/
      ApprovalsPage.tsx
      ApprovalDetailPage.tsx
      MyRequestsPage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  approvals: {
    list: ApprovalRequest[];
    pending: ApprovalRequest[];
    myRequests: ApprovalRequest[];
    selectedApproval: ApprovalRequest | null;
    isLoading: boolean;
    error: string | null;
    filters: {
      status?: string;
      requestType?: string;
      entityType?: string;
    };
  }
}
```

**Actions:**
- `fetchApprovals`: Onay isteklerini getir
- `fetchPendingApprovals`: Bekleyen onay isteklerini getir
- `fetchMyRequests`: Kullanıcının isteklerini getir
- `fetchApprovalById`: Belirli onay isteğini getir
- `approveRequest`: Onay isteğini onayla
- `rejectRequest`: Onay isteğini reddet
- `cancelRequest`: Onay isteğini iptal et
- `setFilters`: Filtreleri ayarla

### React Hook Kullanımı

**useApprovals Hook:**
```typescript
const {
  approvals,
  isLoading,
  error,
  filters,
  fetchApprovals,
  setFilters
} = useApprovals();
```

**usePendingApprovals Hook:**
```typescript
const {
  pendingApprovals,
  count,
  isLoading,
  error,
  fetchPendingApprovals,
  refresh
} = usePendingApprovals();
```

**useApproval Hook:**
```typescript
const {
  approval,
  isLoading,
  error,
  fetchApproval,
  approveRequest,
  rejectRequest,
  cancelRequest,
  canApprove,
  canReject,
  canCancel
} = useApproval(approvalId);
```

---

## Kullanım Senaryoları

### Senaryo 1: Bekleyen Onayları Görüntüleme
1. Kullanıcı dashboard'a gider
2. `GET /approvals/pending` çağrılır
3. Bekleyen onaylar widget'ında gösterilir
4. Onay sayısı badge olarak gösterilir

### Senaryo 2: Onay İsteklerini Listeleme
1. Kullanıcı onay yönetimi sayfasına gider
2. `GET /approvals` çağrılır (filtrelerle)
3. Onay istekleri tablo formatında listelenir
4. Filtreleme ve arama yapılabilir

### Senaryo 3: Onay İsteğini Onaylama
1. Approver bekleyen onaylar listesinden bir isteği seçer
2. Onay isteği detay sayfasına gider
3. İlgili varlık (anlaşma) bilgileri gösterilir
4. "Onayla" butonuna tıklar
5. Onay modalı açılır (yorum eklenebilir)
6. `POST /approvals/:id/approve` çağrılır
7. Onay isteği onaylanır ve ilgili varlık güncellenir

### Senaryo 4: Onay İsteğini Reddetme
1. Approver onay isteği detay sayfasında "Reddet" butonuna tıklar
2. Red modalı açılır (red nedeni zorunlu)
3. Red nedeni girilir
4. `POST /approvals/:id/reject` çağrılır
5. Onay isteği reddedilir ve ilgili varlık güncellenir

### Senaryo 5: Onay İsteğini İptal Etme
1. Planner "Benim İsteklerim" sayfasına gider
2. PENDING durumundaki bir isteği seçer
3. "İptal Et" butonuna tıklar
4. Onay modalı gösterilir
5. `POST /approvals/:id/cancel` çağrılır
6. Onay isteği iptal edilir

---

## UI/UX Önerileri

### Onay İstekleri Listesi
- Tablo formatında gösterim
- Durum badge'leri (renkli)
- Sıralama özelliği
- Filtreleme (durum, tip, varlık tipi)
- Pagination
- Hızlı onay/red butonları (satır içi)

### Bekleyen Onaylar Widget
- Dashboard'da kart görünümü
- Onay sayısı badge'i
- Hızlı erişim butonları
- Son onaylar listesi

### Onay İsteği Detay
- Kart görünümü
- İlgili varlık bilgileri (anlaşma detayı)
- Durum badge'i
- Onay/Red butonları (PENDING ise)
- Durum geçmişi timeline
- Yorumlar ve notlar

### Onay/Red Modalları
- Onay modalı: Yorum eklenebilir
- Red modalı: Red nedeni zorunlu
- Form validasyonu
- Loading state
- Başarı/hata mesajları

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN, APPROVER ve FINANCE rolleri onaylayabilir/reddedebilir
   - Sadece isteği oluşturan kullanıcı iptal edebilir
   - Tüm roller kendi isteklerini görebilir

2. **Durum Kontrolü:**
   - Sadece PENDING istekler onaylanabilir/reddedilebilir
   - Sadece PENDING istekler iptal edilebilir
   - Frontend'de durum kontrolü yapılmalı (UX için)

3. **Yetki Kontrolü:**
   - Kullanıcının onaylama yetkisi kontrol edilmeli
   - Sadece yetkili kullanıcılar onay/red butonlarını görmeli

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Geçersiz durum geçişi
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Onay isteği bulunamadı

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Durum geçiş hataları için özel mesajlar
- Network hataları için retry mekanizması

---

## Özet

Approvals modülü, onay yönetiminin tüm işlevlerini kapsar. Onay istekleri listelenebilir, onaylanabilir, reddedilebilir ve iptal edilebilir. Bekleyen onaylar dashboard'da gösterilebilir ve hızlı onay işlemleri yapılabilir.

**Önemli Endpoint'ler:**
- `GET /approvals` - Onay istekleri listesi
- `GET /approvals/pending` - Bekleyen onaylar
- `GET /approvals/my-requests` - Kullanıcının istekleri
- `GET /approvals/:id` - Onay isteği detayı
- `POST /approvals/:id/approve` - Onay isteğini onayla
- `POST /approvals/:id/reject` - Onay isteğini reddet
- `POST /approvals/:id/cancel` - Onay isteğini iptal et

**Frontend Gereksinimleri:**
- Onay istekleri listesi komponenti
- Onay isteği detay sayfası
- Bekleyen onaylar widget'ı
- Onay/Red modalları
- "Benim İsteklerim" sayfası
- State management (Redux)
- Durum bazlı işlem kontrolü
