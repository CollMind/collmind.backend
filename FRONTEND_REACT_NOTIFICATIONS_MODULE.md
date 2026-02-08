# Frontend React.js - Notifications Modülü

## Genel Bakış

Notifications modülü, bildirim yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Bildirimleri listeleme, okunmamış bildirimleri getirme ve bildirimleri okundu olarak işaretleme işlemlerini kapsar. Bu modül, kullanıcılara sistem olayları hakkında bilgi verir.

## Endpoint'ler

### GET `/notifications`
**Açıklama:** Mevcut kullanıcının tüm bildirimlerini getirme

**Query Parameters:**
```typescript
{
  limit?: number;                   // Maksimum bildirim sayısı, default: 30
}
```

**Response (200 OK):**
```typescript
Array<{
  id: string;
  type: 'APPROVAL_REQUEST' | 'AGREEMENT_APPROVED' | 'AGREEMENT_REJECTED' | 'BUDGET_ALERT' | 'SYSTEM' | 'OTHER';
  title: string;
  message: string;
  channel: 'IN_APP' | 'EMAIL' | 'SMS';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'UNREAD' | 'READ';
  readAt?: Date;
  metadata?: object;                // Ek bilgiler (entityId, entityType vb.)
  createdAt: Date;
}>
```

**Çalışma Mantığı:**
1. Bildirimler sayfası açıldığında çağrılır
2. Mevcut kullanıcının bildirimleri listelenir
3. En yeni bildirimler önce gösterilir
4. Limit parametresi ile sayfa başına bildirim sayısı kontrol edilir

**Frontend Kullanım Senaryosu:**
- Bildirimler sayfası
- Bildirim listesi (dropdown veya sayfa)
- Bildirim kartları
- Okundu/okunmadı durumu gösterimi
- Öncelik badge'leri

---

### GET `/notifications/unread`
**Açıklama:** Mevcut kullanıcının okunmamış bildirimlerini getirme

**Response (200 OK):** Okunmamış bildirimler dizisi

**Çalışma Mantığı:**
1. Header'daki bildirim ikonunda okunmamış sayısı gösterilir
2. Bildirim dropdown'unda okunmamış bildirimler gösterilir
3. Dashboard'da okunmamış bildirimler widget'ı için kullanılır

**Frontend Kullanım Senaryosu:**
- Header'da bildirim ikonu (badge ile sayı)
- Bildirim dropdown'u
- Dashboard widget'ı
- Okunmamış bildirim sayısı

---

### POST `/notifications/:id/read`
**Açıklama:** Bildirimi okundu olarak işaretleme

**Response (200 OK):** Okundu olarak işaretlenmiş bildirim objesi

**Çalışma Mantığı:**
1. Kullanıcı bildirime tıkladığında çağrılır
2. Bildirim durumu READ'e geçer
3. readAt alanı güncellenir
4. Okunmamış bildirim sayısı güncellenir

**Frontend Kullanım Senaryosu:**
- Bildirim kartına tıklandığında
- Bildirim detay sayfasına gidildiğinde
- "Tümünü okundu işaretle" butonu
- Otomatik okundu işaretleme (açıldığında)

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      notifications.service.ts
  hooks/
    useNotifications.ts
    useUnreadNotifications.ts
  components/
    notifications/
      NotificationList.tsx
      NotificationItem.tsx
      NotificationDropdown.tsx
      NotificationBadge.tsx
      NotificationBell.tsx
  pages/
    notifications/
      NotificationsPage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  notifications: {
    list: Notification[];
    unread: Notification[];
    unreadCount: number;
    isLoading: boolean;
    error: string | null;
  }
}
```

**Actions:**
- `fetchNotifications`: Bildirimleri getir
- `fetchUnreadNotifications`: Okunmamış bildirimleri getir
- `markAsRead`: Bildirimi okundu işaretle
- `markAllAsRead`: Tüm bildirimleri okundu işaretle
- `updateUnreadCount`: Okunmamış sayısını güncelle

### React Hook Kullanımı

**useNotifications Hook:**
```typescript
const {
  notifications,
  isLoading,
  error,
  fetchNotifications,
  markAsRead,
  markAllAsRead
} = useNotifications();
```

**useUnreadNotifications Hook:**
```typescript
const {
  unreadNotifications,
  unreadCount,
  isLoading,
  error,
  fetchUnreadNotifications,
  markAsRead,
  refresh
} = useUnreadNotifications();
```

### Real-time Updates

**WebSocket veya Polling:**
- WebSocket ile gerçek zamanlı bildirim güncellemeleri
- Veya polling ile periyodik kontrol (30 saniye)
- Yeni bildirim geldiğinde toast notification gösterimi
- Okunmamış sayısının otomatik güncellenmesi

---

## Kullanım Senaryoları

### Senaryo 1: Bildirimleri Görüntüleme
1. Kullanıcı header'daki bildirim ikonuna tıklar
2. `GET /notifications/unread` çağrılır
3. Okunmamış bildirimler dropdown'da gösterilir
4. "Tümünü Gör" butonuna tıklanırsa bildirimler sayfasına gidilir

### Senaryo 2: Bildirimi Okundu İşaretleme
1. Kullanıcı bir bildirime tıklar
2. `POST /notifications/:id/read` çağrılır
3. Bildirim okundu olarak işaretlenir
4. Okunmamış sayısı güncellenir
5. İlgili sayfaya yönlendirilir (metadata'ya göre)

### Senaryo 3: Tüm Bildirimleri Okundu İşaretleme
1. Kullanıcı "Tümünü Okundu İşaretle" butonuna tıklar
2. Tüm okunmamış bildirimler için `POST /notifications/:id/read` çağrılır
3. Tüm bildirimler okundu olarak işaretlenir
4. Okunmamış sayısı sıfırlanır

### Senaryo 4: Yeni Bildirim Geldiğinde
1. WebSocket veya polling ile yeni bildirim tespit edilir
2. Toast notification gösterilir
3. Bildirim dropdown'u güncellenir
4. Okunmamış sayısı artar
5. Bildirim sesi çalınabilir (kullanıcı ayarına göre)

### Senaryo 5: Bildirim Detayına Gitme
1. Kullanıcı bildirime tıklar
2. Bildirim okundu olarak işaretlenir
3. Metadata'ya göre ilgili sayfaya yönlendirilir
   - APPROVAL_REQUEST → Onay detay sayfası
   - AGREEMENT_APPROVED → Anlaşma detay sayfası
   - BUDGET_ALERT → Bütçe detay sayfası

---

## UI/UX Önerileri

### Bildirim İkonu (Header)
- Bell ikonu
- Okunmamış sayısı badge'i (kırmızı nokta veya sayı)
- Hover efekti
- Tıklanabilir

### Bildirim Dropdown
- Header'da açılan dropdown
- Okunmamış bildirimler önce gösterilir
- Her bildirim için:
  - Başlık
  - Mesaj (kısaltılmış)
  - Zaman (örn: "2 saat önce")
  - Öncelik badge'i
  - Okundu/okunmadı durumu
- "Tümünü Gör" butonu
- "Tümünü Okundu İşaretle" butonu
- Scroll edilebilir liste

### Bildirimler Sayfası
- Tam sayfa görünümü
- Bildirim listesi (kart formatında)
- Filtreleme (tip, öncelik, durum)
- Sıralama (tarih, öncelik)
- Pagination veya infinite scroll
- "Tümünü Okundu İşaretle" butonu

### Bildirim Kartı
- Başlık (kalın)
- Mesaj
- Zaman bilgisi
- Öncelik badge'i
- Durum badge'i (okundu/okunmadı)
- Tıklanabilir (detaya git)

### Toast Notification
- Yeni bildirim geldiğinde gösterilir
- Kısa süre gösterilir (3-5 saniye)
- Tıklanabilir (bildirime git)
- Kapatılabilir
- Animasyonlu giriş/çıkış

---

## Bildirim Tipleri ve Yönlendirmeler

**APPROVAL_REQUEST:**
- Mesaj: "Yeni onay isteği: [Anlaşma Adı]"
- Yönlendirme: `/approvals/:id`
- Öncelik: HIGH

**AGREEMENT_APPROVED:**
- Mesaj: "Anlaşma onaylandı: [Anlaşma Numarası]"
- Yönlendirme: `/agreements/:id`
- Öncelik: MEDIUM

**AGREEMENT_REJECTED:**
- Mesaj: "Anlaşma reddedildi: [Anlaşma Numarası]"
- Yönlendirme: `/agreements/:id`
- Öncelik: MEDIUM

**BUDGET_ALERT:**
- Mesaj: "Bütçe uyarısı: [Mesaj]"
- Yönlendirme: `/budget/envelopes/:id`
- Öncelik: HIGH

**SYSTEM:**
- Mesaj: Sistem mesajı
- Yönlendirme: Genellikle yok
- Öncelik: LOW

---

## Güvenlik Notları

1. **Kullanıcı İzolasyonu:**
   - Her kullanıcı sadece kendi bildirimlerini görebilir
   - Backend kullanıcı ID'sine göre filtreler

2. **Bildirim Gizliliği:**
   - Hassas bilgiler bildirimlerde gösterilmemeli
   - Sadece gerekli bilgiler gösterilmeli

3. **Rate Limiting:**
   - Çok fazla bildirim oluşturulmasını önlemek için
   - Backend'de rate limiting uygulanmalı

---

## Hata Yönetimi

**Hata Tipleri:**
- `401 Unauthorized`: Yetkisiz erişim
- `404 Not Found`: Bildirim bulunamadı
- `500 Internal Server Error`: Sunucu hatası

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Network hataları için retry mekanizması
- Bildirim yüklenemezse kullanıcıya bilgi verilmeli

---

## Özet

Notifications modülü, bildirim yönetiminin tüm işlevlerini kapsar. Bildirimler listelenebilir, okunmamış bildirimler gösterilebilir ve bildirimler okundu olarak işaretlenebilir. Real-time güncellemeler ile kullanıcılar yeni bildirimlerden anında haberdar olabilir.

**Önemli Endpoint'ler:**
- `GET /notifications` - Bildirimleri getir
- `GET /notifications/unread` - Okunmamış bildirimleri getir
- `POST /notifications/:id/read` - Bildirimi okundu işaretle

**Frontend Gereksinimleri:**
- Bildirim ikonu (header)
- Bildirim dropdown'u
- Bildirimler sayfası
- Bildirim kartları
- Toast notification
- Real-time updates (WebSocket veya polling)
- State management (Redux)
- Okunmamış sayısı takibi
