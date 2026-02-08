# Frontend React.js - Modül Dökümanları İndeksi

## Genel Bakış

Bu dokümantasyon, Sprint 0 ve Sprint 1 kapsamında geliştirilmiş tüm backend endpoint'leri için React.js frontend geliştirme rehberlerini içerir. Her modül için ayrı bir döküman oluşturulmuştur.

## Modül Listesi

### 1. Authentication Modülü
**Dosya:** `FRONTEND_REACT_AUTHENTICATION_MODULE.md`

**Kapsam:**
- Kullanıcı girişi (login)
- Token yenileme (refresh)
- Kullanıcı çıkışı (logout)

**Endpoint'ler:**
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

**Özellikler:**
- JWT token yönetimi
- Axios interceptor yapılandırması
- Route protection
- Token saklama mekanizması

---

### 2. Users Modülü
**Dosya:** `FRONTEND_REACT_USERS_MODULE.md`

**Kapsam:**
- Kullanıcı oluşturma, güncelleme, silme
- Profil yönetimi
- Şifre değiştirme
- Kullanıcı durum yönetimi (aktif/pasif)

**Endpoint'ler:**
- `POST /users` - Kullanıcı oluşturma
- `GET /users` - Kullanıcı listesi
- `GET /users/me` - Profil bilgisi
- `PATCH /users/me` - Profil güncelleme
- `PATCH /users/me/password` - Şifre değiştirme
- `PATCH /users/:id` - Kullanıcı güncelleme (Admin)
- `DELETE /users/:id` - Kullanıcı silme (Admin)
- `POST /users/:id/activate` - Kullanıcı aktif etme (Admin)
- `POST /users/:id/deactivate` - Kullanıcı pasif etme (Admin)

**Özellikler:**
- Role-based access control
- Form validasyonu
- Profil yönetimi
- Şifre güvenliği

---

### 3. Customers Modülü
**Dosya:** `FRONTEND_REACT_CUSTOMERS_MODULE.md`

**Kapsam:**
- Müşteri oluşturma, güncelleme, silme
- Müşteri arama ve filtreleme
- Toplu müşteri import (Excel/CSV)
- Müşteri istatistikleri

**Endpoint'ler:**
- `POST /customers` - Müşteri oluşturma
- `POST /customers/bulk` - Toplu müşteri oluşturma
- `GET /customers` - Müşteri listesi (filtreleme ile)
- `GET /customers/search` - Müşteri arama
- `GET /customers/:id` - Müşteri detayı
- `PATCH /customers/:id` - Müşteri güncelleme
- `DELETE /customers/:id` - Müşteri silme
- `POST /customers/import` - Müşteri import
- `GET /customers/:id/stats` - Müşteri istatistikleri

**Özellikler:**
- Gelişmiş filtreleme ve arama
- Toplu import (Excel/CSV)
- Form validasyonu
- Dosya yükleme ve işleme

---

### 4. Tenants Modülü
**Dosya:** `FRONTEND_REACT_TENANTS_MODULE.md`

**Kapsam:**
- Kiracı oluşturma, güncelleme, silme
- Kiracı durum yönetimi (aktif/pasif/askıya alma)
- Kiracı istatistikleri

**Endpoint'ler:**
- `POST /tenants` - Kiracı oluşturma (Admin)
- `GET /tenants` - Kiracı listesi (Admin)
- `GET /tenants/:id` - Kiracı detayı
- `PATCH /tenants/:id` - Kiracı güncelleme (Admin)
- `DELETE /tenants/:id` - Kiracı silme (Admin)
- `POST /tenants/:id/activate` - Kiracı aktif etme (Admin)
- `POST /tenants/:id/suspend` - Kiracı askıya alma (Admin)
- `GET /tenants/:id/stats` - Kiracı istatistikleri

**Özellikler:**
- Multi-tenant yönetimi
- Kiracı ayarları yönetimi
- İstatistik görüntüleme

---

### 5. Budget Modülü
**Dosya:** `FRONTEND_REACT_BUDGET_MODULE.md`

**Kapsam:**
- Bütçe zarfı oluşturma
- Bütçe rezervasyonu
- Rezerve edilmiş tutar görüntüleme
- İşlem geçmişi

**Endpoint'ler:**
- `POST /budget/envelopes` - Bütçe zarfı oluşturma
- `GET /budget/envelopes` - Bütçe zarfları listesi
- `GET /budget/envelopes/:id` - Bütçe zarfı detayı
- `POST /budget/reserve` - Bütçe rezervasyonu
- `GET /budget/envelopes/:id/reserved` - Rezerve edilmiş tutar
- `GET /budget/envelopes/:id/transactions` - İşlem geçmişi

**Özellikler:**
- Event-sourced bütçe yönetimi
- Bütçe hesaplamaları
- İşlem geçmişi takibi
- Bütçe kontrolü

---

### 6. Agreements Modülü
**Dosya:** `FRONTEND_REACT_AGREEMENTS_MODULE.md`

**Kapsam:**
- Anlaşma oluşturma, güncelleme, silme
- Anlaşma onaylama, reddetme, iptal etme
- Durum makinesi yönetimi

**Endpoint'ler:**
- `POST /agreements` - Anlaşma oluşturma
- `GET /agreements` - Anlaşma listesi
- `GET /agreements/:id` - Anlaşma detayı
- `PATCH /agreements/:id` - Anlaşma güncelleme (DRAFT)
- `POST /agreements/:id/submit` - Onay için gönderme
- `POST /agreements/:id/approve` - Anlaşmayı onaylama
- `POST /agreements/:id/reject` - Anlaşmayı reddetme
- `POST /agreements/:id/cancel` - Anlaşmayı iptal etme
- `DELETE /agreements/:id` - Anlaşmayı silme (DRAFT)

**Özellikler:**
- State machine yönetimi
- Durum bazlı işlem kontrolü
- Onay süreci yönetimi
- Bütçe rezervasyonu entegrasyonu

---

### 7. Approvals Modülü
**Dosya:** `FRONTEND_REACT_APPROVALS_MODULE.md`

**Kapsam:**
- Onay isteklerini listeleme
- Onay isteklerini onaylama, reddetme
- Bekleyen onayları görüntüleme
- Kullanıcının isteklerini görüntüleme

**Endpoint'ler:**
- `GET /approvals` - Onay istekleri listesi
- `GET /approvals/pending` - Bekleyen onaylar
- `GET /approvals/my-requests` - Kullanıcının istekleri
- `GET /approvals/:id` - Onay isteği detayı
- `POST /approvals/:id/approve` - Onay isteğini onayla
- `POST /approvals/:id/reject` - Onay isteğini reddet
- `POST /approvals/:id/cancel` - Onay isteğini iptal et

**Özellikler:**
- Onay süreci yönetimi
- Bekleyen onaylar widget'ı
- Durum takibi
- Yetki kontrolü

---

### 8. Notifications Modülü
**Dosya:** `FRONTEND_REACT_NOTIFICATIONS_MODULE.md`

**Kapsam:**
- Bildirimleri listeleme
- Okunmamış bildirimleri görüntüleme
- Bildirimleri okundu işaretleme

**Endpoint'ler:**
- `GET /notifications` - Bildirimleri getir
- `GET /notifications/unread` - Okunmamış bildirimleri getir
- `POST /notifications/:id/read` - Bildirimi okundu işaretle

**Özellikler:**
- Real-time bildirim güncellemeleri
- Bildirim dropdown'u
- Toast notification
- Okunmamış sayısı takibi

---

### 9. Ledger Modülü
**Dosya:** `FRONTEND_REACT_LEDGER_MODULE.md`

**Kapsam:**
- Defter kayıtlarını listeleme
- Anlaşma veya bütçe zarfı bazında filtreleme
- Tüketilen tutarları görüntüleme

**Endpoint'ler:**
- `GET /ledger` - Defter kayıtları listesi
- `GET /ledger/agreement/:agreementId` - Anlaşmaya ait kayıtlar
- `GET /ledger/agreement/:agreementId/consumed` - Anlaşma için tüketilen tutar
- `GET /ledger/envelope/:envelopeId` - Bütçe zarfına ait kayıtlar
- `GET /ledger/envelope/:envelopeId/consumed` - Bütçe zarfı için tüketilen tutar
- `GET /ledger/:id` - Defter kaydı detayı

**Özellikler:**
- Finansal işlem takibi
- Bütçe kullanım analizi
- Export özelliği
- Filtreleme ve raporlama

---

## Ortak Özellikler

### API Client Yapılandırması
Tüm modüller için ortak API client yapılandırması:
- Axios instance
- Request interceptor (token ekleme)
- Response interceptor (token yenileme, hata yönetimi)
- Base URL yapılandırması

### State Management
- Redux Toolkit kullanımı
- Modül bazında slice'lar
- Async thunk'lar
- Selector'lar

### Form Yönetimi
- React Hook Form
- Zod validasyonu
- Form state yönetimi
- Hata gösterimi

### UI/UX
- Tailwind CSS
- shadcn/ui komponentleri
- Responsive tasarım
- Loading states
- Error handling
- Success feedback

### Güvenlik
- Role-based access control
- Route protection
- Token yönetimi
- XSS koruması
- CSRF koruması

---

## Geliştirme Sırası Önerisi

1. **Authentication Modülü** - Temel güvenlik ve token yönetimi
2. **Users Modülü** - Kullanıcı yönetimi ve profil
3. **Customers Modülü** - Müşteri yönetimi ve import
4. **Budget Modülü** - Bütçe yönetimi
5. **Agreements Modülü** - Anlaşma yönetimi ve onay süreci
6. **Approvals Modülü** - Onay yönetimi
7. **Notifications Modülü** - Bildirim sistemi
8. **Ledger Modülü** - Finansal takip
9. **Tenants Modülü** - Multi-tenant yönetimi (Admin)

---

## Notlar

- Her modül için detaylı döküman ayrı dosyalarda bulunmaktadır
- Tüm endpoint'ler için request/response formatları belirtilmiştir
- Her modül için kullanım senaryoları ve UI/UX önerileri mevcuttur
- Güvenlik notları ve hata yönetimi stratejileri belirtilmiştir
- Frontend gereksinimleri ve dosya yapıları önerilmiştir

---

## Son Güncelleme

**Tarih:** Ocak 2026  
**Versiyon:** 1.0  
**Durum:** Sprint 0 ve Sprint 1 kapsamında tüm modüller için dökümantasyon tamamlandı
