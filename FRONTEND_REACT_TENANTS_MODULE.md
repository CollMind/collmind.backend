# Frontend React.js - Tenants Modülü

## Genel Bakış

Tenants modülü, çoklu kiracı (multi-tenant) yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Kiracı oluşturma, güncelleme, silme, aktif/pasif etme ve istatistik görüntüleme işlemlerini kapsar. Bu modül genellikle sistem yöneticileri (ADMIN) tarafından kullanılır.

## Endpoint'ler

### POST `/tenants`
**Açıklama:** Yeni kiracı oluşturma (ADMIN rolü gerekli)

**Request Body:**
```typescript
{
  name: string;                    // Zorunlu, min 3, max 200 karakter
  domain?: string;                 // Opsiyonel, max 100 karakter
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TRIAL';
  plan?: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  taxNumber?: string;
  companyRegistrationNumber?: string;
  industry?: string;
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string;
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
  };
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  name: string;
  domain?: string;
  status: string;
  plan: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Hata Yanıtları:**
- `409 Conflict`: Kiracı zaten mevcut (domain veya name)

**Çalışma Mantığı:**
1. Admin yeni kiracı formunu doldurur
2. Form validasyonu yapılır (name zorunlu)
3. Backend'e istek gönderilir
4. Başarılıysa kiracı oluşturulur ve detay sayfasına yönlendirilir
5. Hata durumunda kullanıcıya bilgi verilir

**Frontend Kullanım Senaryosu:**
- Admin panelinde "Yeni Kiracı" butonuna tıklandığında
- Form modal veya ayrı sayfa olarak açılır
- Tüm zorunlu alanlar doldurulmalı
- Domain benzersizlik kontrolü (real-time)

---

### GET `/tenants`
**Açıklama:** Tüm kiracıları listeleme (ADMIN rolü gerekli)

**Response (200 OK):**
```typescript
Array<{
  id: string;
  name: string;
  domain?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TRIAL';
  plan: 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  contactEmail?: string;
  contactPerson?: string;
  createdAt: Date;
  updatedAt: Date;
}>
```

**Çalışma Mantığı:**
1. Kiracı yönetimi sayfası açıldığında çağrılır
2. Tüm kiracılar tablo formatında gösterilir
3. Filtreleme ve arama özellikleri eklenebilir
4. Pagination uygulanabilir

**Frontend Kullanım Senaryosu:**
- Kiracı yönetimi sayfasında
- Tablo formatında listeleme
- Sıralama, filtreleme, arama özellikleri
- Her satırda düzenleme/silme butonları
- Durum badge'leri

---

### GET `/tenants/:id`
**Açıklama:** Belirli bir kiracının detaylarını getirme

**Response (200 OK):**
```typescript
{
  id: string;
  name: string;
  domain?: string;
  status: string;
  plan: string;
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  taxNumber?: string;
  companyRegistrationNumber?: string;
  industry?: string;
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string;
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

**Hata Yanıtları:**
- `404 Not Found`: Kiracı bulunamadı

**Çalışma Mantığı:**
1. Kiracı detay sayfası açıldığında çağrılır
2. Kiracı bilgileri gösterilir
3. İstatistikler ve ilgili veriler gösterilebilir

**Frontend Kullanım Senaryosu:**
- Kiracı detay sayfası
- Kiracı bilgileri kartı
- İstatistikler bölümü
- Ayarlar bölümü

---

### PATCH `/tenants/:id`
**Açıklama:** Kiracı bilgilerini güncelleme (ADMIN rolü gerekli)

**Request Body:** Partial CreateTenantDto

**Response (200 OK):** Güncellenmiş kiracı objesi

**Çalışma Mantığı:**
1. Kiracı düzenleme formu açılır
2. Mevcut bilgilerle doldurulur
3. Güncellemeler yapılır ve submit edilir
4. Backend'e güncelleme isteği gönderilir
5. Başarılıysa kiracı bilgileri güncellenir

**Frontend Kullanım Senaryosu:**
- Kiracı düzenleme sayfası
- Form validasyonu
- Değişiklik takibi
- Ayarlar güncelleme

---

### DELETE `/tenants/:id`
**Açıklama:** Kiracıyı silme (ADMIN rolü gerekli)

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Kiracı silme butonuna tıklanır
2. Kritik işlem onay modalı gösterilir
3. Kiracı adı tekrar girilir (güvenlik için)
4. Onaylandığında silme isteği gönderilir
5. Kiracı silinir ve listeden kaldırılır

**Frontend Kullanım Senaryosu:**
- Kiracı listesinde silme butonu
- Kritik işlem onay modalı
- Kiracı adı doğrulama
- Başarı mesajı ve liste güncelleme

---

### POST `/tenants/:id/activate`
**Açıklama:** Kiracıyı aktif etme (ADMIN rolü gerekli)

**Response (200 OK):** Aktif edilmiş kiracı objesi

**Çalışma Mantığı:**
1. Kiracı durum değiştirme butonuna tıklanır
2. Kiracı durumu ACTIVE olur
3. Kiracı sistemi kullanabilir

**Frontend Kullanım Senaryosu:**
- Kiracı listesinde durum değiştirme butonu
- Onay modalı
- Başarı mesajı

---

### POST `/tenants/:id/suspend`
**Açıklama:** Kiracıyı askıya alma (ADMIN rolü gerekli)

**Response (200 OK):** Askıya alınmış kiracı objesi

**Çalışma Mantığı:**
1. Kiracı askıya alma butonuna tıklanır
2. Onay modalı gösterilir
3. Onaylandığında kiracı durumu SUSPENDED olur
4. Kiracı sisteme erişemez

**Frontend Kullanım Senaryosu:**
- Kiracı listesinde askıya alma butonu
- Kritik işlem onay modalı
- Başarı mesajı

---

### GET `/tenants/:id/stats`
**Açıklama:** Kiracı istatistiklerini getirme

**Response (200 OK):**
```typescript
{
  totalUsers: number;
  totalCustomers: number;
  totalBudgetEnvelopes: number;
  totalAgreements: number;
}
```

**Çalışma Mantığı:**
1. Kiracı detay sayfasında istatistikler gösterilir
2. Dashboard kartları için veri sağlar

**Frontend Kullanım Senaryosu:**
- Kiracı detay sayfasında istatistik kartları
- Dashboard'da kiracı özeti
- Grafikler ve görselleştirmeler

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      tenants.service.ts
  hooks/
    useTenants.ts
    useTenant.ts
  components/
    tenants/
      TenantList.tsx
      TenantForm.tsx
      TenantDetail.tsx
      TenantStats.tsx
  pages/
    tenants/
      TenantsPage.tsx
      TenantDetailPage.tsx
      TenantCreatePage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  tenants: {
    list: Tenant[];
    selectedTenant: Tenant | null;
    isLoading: boolean;
    error: string | null;
    filters: {
      status?: string;
      plan?: string;
      search?: string;
    };
  }
}
```

**Actions:**
- `fetchTenants`: Kiracı listesini getir
- `fetchTenantById`: Belirli kiracıyı getir
- `createTenant`: Yeni kiracı oluştur
- `updateTenant`: Kiracı güncelle
- `deleteTenant`: Kiracı sil
- `activateTenant`: Kiracıyı aktif et
- `suspendTenant`: Kiracıyı askıya al
- `fetchTenantStats`: Kiracı istatistiklerini getir

### React Hook Kullanımı

**useTenants Hook:**
```typescript
const {
  tenants,
  isLoading,
  error,
  fetchTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  activateTenant,
  suspendTenant
} = useTenants();
```

**useTenant Hook:**
```typescript
const {
  tenant,
  stats,
  isLoading,
  error,
  fetchTenant,
  updateTenant,
  activateTenant,
  suspendTenant,
  fetchStats
} = useTenant(tenantId);
```

### Form Yönetimi

**Kiracı Oluşturma Formu:**
- Temel bilgiler (name, domain, status, plan)
- İletişim bilgileri (email, phone, person)
- Adres bilgileri
- Ayarlar (currency, timezone, dateFormat)
- Form validasyonu
- Domain benzersizlik kontrolü (real-time)

**Kiracı Düzenleme Formu:**
- Mevcut bilgilerle doldurulmuş form
- Değişiklik takibi
- Ayarlar güncelleme

---

## Kullanım Senaryoları

### Senaryo 1: Kiracı Listesi Görüntüleme
1. Admin kiracı yönetimi sayfasına gider
2. `GET /tenants` çağrılır
3. Kiracılar tablo formatında listelenir
4. Filtreleme ve arama yapılabilir
5. Her kiracı için düzenleme/silme butonları görünür

### Senaryo 2: Yeni Kiracı Oluşturma
1. Admin "Yeni Kiracı" butonuna tıklar
2. Form modal veya sayfa açılır
3. Form doldurulur ve validasyon yapılır
4. `POST /tenants` çağrılır
5. Başarılıysa kiracı listesine eklenir
6. Hata durumunda hata mesajı gösterilir

### Senaryo 3: Kiracı Detay Görüntüleme
1. Admin kiracı listesinden bir kiracıya tıklar
2. `GET /tenants/:id` çağrılır
3. Kiracı detayları gösterilir
4. `GET /tenants/:id/stats` ile istatistikler gösterilir
5. İlgili kullanıcılar, müşteriler gösterilebilir

### Senaryo 4: Kiracı Durum Değiştirme
1. Admin kiracı listesinde durum değiştirme butonuna tıklar
2. Onay modalı gösterilir
3. Onaylandığında `POST /tenants/:id/activate` veya `POST /tenants/:id/suspend` çağrılır
4. Kiracı durumu güncellenir
5. Liste yenilenir

### Senaryo 5: Kiracı Silme
1. Admin kiracı listesinde silme butonuna tıklar
2. Kritik işlem onay modalı gösterilir
3. Kiracı adı tekrar girilir (güvenlik için)
4. Onaylandığında `DELETE /tenants/:id` çağrılır
5. Kiracı silinir ve listeden kaldırılır

### Senaryo 6: Kiracı Ayarları Güncelleme
1. Admin kiracı detay sayfasında ayarlar bölümüne gider
2. Ayarlar formu doldurulur
3. `PATCH /tenants/:id` çağrılır
4. Ayarlar güncellenir

---

## UI/UX Önerileri

### Kiracı Listesi
- Tablo formatında gösterim
- Sıralama özelliği (ad, durum, plan, oluşturulma tarihi)
- Filtreleme (durum, plan)
- Arama özelliği
- Durum badge'leri (renkli)
- Plan badge'leri
- Toplu işlemler (seçili kiracıları aktif/pasif et)

### Kiracı Formu
- Modal veya ayrı sayfa
- Tab yapısı (Temel Bilgiler, İletişim, Ayarlar)
- Form validasyonu
- Loading state
- Error handling
- Success feedback

### Kiracı Detay
- Kart görünümü
- Tab yapısı (Genel Bilgiler, İstatistikler, Ayarlar, Kullanıcılar)
- İstatistik kartları (kullanıcı sayısı, müşteri sayısı, vb.)
- Grafikler (kullanım istatistikleri)
- Düzenleme butonu

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN rolü kiracı yönetimi yapabilir
   - Diğer roller kiracı bilgilerini göremez

2. **Kritik İşlemler:**
   - Kiracı silme işlemi için çift onay
   - Kiracı askıya alma işlemi için onay
   - Kiracı adı doğrulama (silme için)

3. **Form Validasyonu:**
   - Name zorunlu ve benzersiz olmalı
   - Domain benzersizlik kontrolü
   - Email format kontrolü

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Geçersiz form verisi
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Kiracı bulunamadı
- `409 Conflict`: Kiracı zaten mevcut (domain veya name)

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Form validasyon hataları form alanlarında gösterilmeli
- Network hataları için retry mekanizması

---

## Özet

Tenants modülü, çoklu kiracı sisteminin yönetimini sağlar. Sadece sistem yöneticileri (ADMIN) tarafından kullanılır ve kiracı oluşturma, düzenleme, silme, durum yönetimi ve istatistik görüntüleme işlemlerini kapsar.

**Önemli Endpoint'ler:**
- `POST /tenants` - Kiracı oluşturma
- `GET /tenants` - Kiracı listesi
- `GET /tenants/:id` - Kiracı detayı
- `PATCH /tenants/:id` - Kiracı güncelleme
- `DELETE /tenants/:id` - Kiracı silme
- `POST /tenants/:id/activate` - Kiracı aktif etme
- `POST /tenants/:id/suspend` - Kiracı askıya alma
- `GET /tenants/:id/stats` - Kiracı istatistikleri

**Frontend Gereksinimleri:**
- Kiracı listesi komponenti
- Kiracı formu komponenti
- Kiracı detay sayfası
- İstatistik komponenti
- State management (Redux)
- Form validasyonu
- Role-based access control
