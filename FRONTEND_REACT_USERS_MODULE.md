# Frontend React.js - Users Modülü

## Genel Bakış

Users modülü, kullanıcı yönetimi için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir. Kullanıcı oluşturma, güncelleme, silme, aktif/pasif etme ve profil yönetimi işlemlerini kapsar.

## Endpoint'ler

### POST `/users`
**Açıklama:** Yeni kullanıcı oluşturma (ADMIN rolü gerekli)

**Request Body:**
```typescript
{
  email: string;                    // Zorunlu, geçerli email formatı
  password: string;                 // Zorunlu, min 8, max 100 karakter
  fullName: string;                 // Zorunlu, min 2, max 200 karakter
  firstName?: string;
  lastName?: string;
  role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';  // Zorunlu
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'LOCKED';
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  mustChangePassword?: boolean;
  permissions?: string[];
}
```

**Response (201 Created):**
```typescript
{
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Çalışma Mantığı:**
1. Admin yeni kullanıcı formunu doldurur
2. Form validasyonu yapılır
3. Backend'e istek gönderilir
4. Başarılıysa kullanıcı listesine eklenir veya detay sayfasına yönlendirilir
5. Hata durumunda kullanıcıya bilgi verilir

**Frontend Kullanım Senaryosu:**
- Admin panelinde "Yeni Kullanıcı" butonuna tıklandığında
- Form modal veya ayrı sayfa olarak açılır
- Tüm zorunlu alanlar doldurulmalı
- Email formatı ve şifre güçlülüğü kontrol edilmeli

---

### GET `/users`
**Açıklama:** Tüm kullanıcıları listeleme (ADMIN, FINANCE rolleri gerekli)

**Response (200 OK):**
```typescript
Array<{
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'LOCKED';
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}>
```

**Çalışma Mantığı:**
1. Kullanıcı listesi sayfası açıldığında çağrılır
2. Tüm kullanıcılar tablo formatında gösterilir
3. Filtreleme ve arama özellikleri eklenebilir
4. Pagination uygulanabilir

**Frontend Kullanım Senaryosu:**
- Kullanıcı yönetimi sayfasında
- Tablo formatında listeleme
- Sıralama, filtreleme, arama özellikleri
- Her satırda düzenleme/silme butonları

---

### GET `/users/me`
**Açıklama:** Mevcut kullanıcının profil bilgilerini getirme

**Response (200 OK):**
```typescript
{
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Çalışma Mantığı:**
1. Profil sayfası açıldığında çağrılır
2. Mevcut kullanıcının bilgileri gösterilir
3. Düzenleme formu bu bilgilerle doldurulur

**Frontend Kullanım Senaryosu:**
- Kullanıcı profil sayfası
- Header'daki kullanıcı menüsü
- Uygulama başlangıcında kullanıcı bilgilerini yükleme

---

### PATCH `/users/me`
**Açıklama:** Mevcut kullanıcının profil bilgilerini güncelleme

**Request Body:**
```typescript
{
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  // Not: password, email, role bu endpoint ile güncellenemez
}
```

**Response (200 OK):** Güncellenmiş kullanıcı objesi

**Çalışma Mantığı:**
1. Kullanıcı profil formunu doldurur
2. Form submit edilir
3. Backend'e güncelleme isteği gönderilir
4. Başarılıysa profil bilgileri güncellenir
5. Redux store güncellenir

**Frontend Kullanım Senaryosu:**
- Profil düzenleme sayfası
- Form validasyonu
- Başarı/hata mesajları

---

### PATCH `/users/me/password`
**Açıklama:** Mevcut kullanıcının şifresini değiştirme

**Request Body:**
```typescript
{
  currentPassword: string;
  newPassword: string;  // min 8 karakter
}
```

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Kullanıcı şifre değiştirme formunu doldurur
2. Mevcut şifre doğrulanır
3. Yeni şifre güçlülük kontrolünden geçer
4. Şifre güncellenir
5. Kullanıcıya bilgi verilir

**Frontend Kullanım Senaryosu:**
- Profil sayfasında şifre değiştirme bölümü
- Mevcut şifre doğrulama
- Yeni şifre güçlülük göstergesi
- Şifre eşleşme kontrolü

---

### GET `/users/:id`
**Açıklama:** Belirli bir kullanıcının detaylarını getirme

**Response (200 OK):** Kullanıcı objesi

**Hata Yanıtları:**
- `404 Not Found`: Kullanıcı bulunamadı

**Çalışma Mantığı:**
1. Kullanıcı detay sayfası açıldığında çağrılır
2. Kullanıcı bilgileri gösterilir
3. Düzenleme butonu ile form açılabilir

**Frontend Kullanım Senaryosu:**
- Kullanıcı detay sayfası
- Kullanıcı listesinden detaya geçiş
- Düzenleme/silme butonları

---

### PATCH `/users/:id`
**Açıklama:** Kullanıcı bilgilerini güncelleme (ADMIN rolü gerekli)

**Request Body:** PATCH `/users/me` ile aynı

**Response (200 OK):** Güncellenmiş kullanıcı objesi

**Çalışma Mantığı:**
1. Admin kullanıcı düzenleme formunu açar
2. Form doldurulur ve submit edilir
3. Backend'e güncelleme isteği gönderilir
4. Başarılıysa kullanıcı bilgileri güncellenir

**Frontend Kullanım Senaryosu:**
- Admin kullanıcı düzenleme sayfası
- Form validasyonu
- Role değişikliği kontrolü (kendi rolünü değiştiremez)

---

### PATCH `/users/:id/password`
**Açıklama:** Kullanıcı şifresini değiştirme (ADMIN rolü gerekli)

**Request Body:**
```typescript
{
  currentPassword: string;
  newPassword: string;  // min 8 karakter
}
```

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Admin kullanıcı şifre değiştirme formunu açar
2. Yeni şifre girilir
3. Şifre güncellenir

**Frontend Kullanım Senaryosu:**
- Admin kullanıcı yönetimi sayfasında
- Şifre sıfırlama özelliği

---

### POST `/users/:id/activate`
**Açıklama:** Kullanıcıyı aktif etme (ADMIN rolü gerekli)

**Response (200 OK):** Aktif edilmiş kullanıcı objesi

**Çalışma Mantığı:**
1. Admin kullanıcı listesinde "Aktif Et" butonuna tıklar
2. Kullanıcı durumu ACTIVE olur
3. Kullanıcı sisteme giriş yapabilir

**Frontend Kullanım Senaryosu:**
- Kullanıcı listesinde durum değiştirme butonu
- Onay modalı
- Başarı mesajı

---

### POST `/users/:id/deactivate`
**Açıklama:** Kullanıcıyı pasif etme (ADMIN rolü gerekli)

**Response (200 OK):** Pasif edilmiş kullanıcı objesi

**Çalışma Mantığı:**
1. Admin kullanıcı listesinde "Pasif Et" butonuna tıklar
2. Kullanıcı durumu INACTIVE olur
3. Kullanıcı sisteme giriş yapamaz

**Frontend Kullanım Senaryosu:**
- Kullanıcı listesinde durum değiştirme butonu
- Onay modalı (kritik işlem)
- Başarı mesajı

---

### DELETE `/users/:id`
**Açıklama:** Kullanıcıyı silme (ADMIN rolü gerekli)

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Admin kullanıcı silme butonuna tıklar
2. Onay modalı gösterilir
3. Onaylandığında kullanıcı silinir
4. Kullanıcı listeden kaldırılır

**Frontend Kullanım Senaryosu:**
- Kullanıcı listesinde silme butonu
- Kritik işlem onay modalı
- Başarı mesajı ve liste güncelleme

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      users.service.ts
  hooks/
    useUsers.ts
    useUserProfile.ts
  components/
    users/
      UserList.tsx
      UserForm.tsx
      UserDetail.tsx
      ChangePasswordForm.tsx
  pages/
    users/
      UsersPage.tsx
      UserDetailPage.tsx
      ProfilePage.tsx
```

### State Management

**Redux Store Yapısı:**
```typescript
{
  users: {
    list: User[];
    currentUser: User | null;
    selectedUser: User | null;
    isLoading: boolean;
    error: string | null;
    filters: {
      role?: string;
      status?: string;
      search?: string;
    };
  }
}
```

**Actions:**
- `fetchUsers`: Kullanıcı listesini getir
- `fetchUserById`: Belirli kullanıcıyı getir
- `createUser`: Yeni kullanıcı oluştur
- `updateUser`: Kullanıcı güncelle
- `deleteUser`: Kullanıcı sil
- `activateUser`: Kullanıcıyı aktif et
- `deactivateUser`: Kullanıcıyı pasif et
- `updateProfile`: Profil güncelle
- `changePassword`: Şifre değiştir

### React Hook Kullanımı

**useUsers Hook:**
```typescript
const {
  users,
  isLoading,
  error,
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  activateUser,
  deactivateUser
} = useUsers();
```

**useUserProfile Hook:**
```typescript
const {
  user,
  isLoading,
  updateProfile,
  changePassword
} = useUserProfile();
```

### Form Yönetimi

**Kullanıcı Oluşturma Formu:**
- Email validasyonu
- Şifre güçlülük kontrolü
- Role seçimi
- Form validasyonu (Zod/React Hook Form)

**Profil Güncelleme Formu:**
- Mevcut bilgilerle doldurulmuş form
- Sadece izin verilen alanlar düzenlenebilir
- Email ve role değiştirilemez

**Şifre Değiştirme Formu:**
- Mevcut şifre doğrulama
- Yeni şifre güçlülük göstergesi
- Şifre eşleşme kontrolü

---

## Kullanım Senaryoları

### Senaryo 1: Kullanıcı Listesi Görüntüleme
1. Admin kullanıcı yönetimi sayfasına gider
2. `GET /users` çağrılır
3. Kullanıcılar tablo formatında listelenir
4. Filtreleme ve arama yapılabilir
5. Her kullanıcı için düzenleme/silme butonları görünür

### Senaryo 2: Yeni Kullanıcı Oluşturma
1. Admin "Yeni Kullanıcı" butonuna tıklar
2. Form modal veya sayfa açılır
3. Form doldurulur ve validasyon yapılır
4. `POST /users` çağrılır
5. Başarılıysa kullanıcı listesine eklenir
6. Hata durumunda hata mesajı gösterilir

### Senaryo 3: Profil Güncelleme
1. Kullanıcı profil sayfasına gider
2. `GET /users/me` ile mevcut bilgiler yüklenir
3. Form doldurulur ve güncelleme yapılır
4. `PATCH /users/me` çağrılır
5. Başarılıysa profil güncellenir ve Redux store güncellenir

### Senaryo 4: Şifre Değiştirme
1. Kullanıcı profil sayfasında şifre değiştirme bölümüne gider
2. Mevcut şifre ve yeni şifre girer
3. `PATCH /users/me/password` çağrılır
4. Başarılıysa kullanıcıya bilgi verilir
5. Hata durumunda (yanlış mevcut şifre) hata mesajı gösterilir

### Senaryo 5: Kullanıcı Durum Değiştirme
1. Admin kullanıcı listesinde durum değiştirme butonuna tıklar
2. Onay modalı gösterilir
3. Onaylandığında `POST /users/:id/activate` veya `POST /users/:id/deactivate` çağrılır
4. Kullanıcı durumu güncellenir
5. Liste yenilenir

### Senaryo 6: Kullanıcı Silme
1. Admin kullanıcı listesinde silme butonuna tıklar
2. Kritik işlem onay modalı gösterilir
3. Kullanıcı email'i tekrar girilir (güvenlik için)
4. Onaylandığında `DELETE /users/:id` çağrılır
5. Kullanıcı silinir ve listeden kaldırılır

---

## UI/UX Önerileri

### Kullanıcı Listesi
- Tablo formatında gösterim
- Sıralama özelliği (ad, email, rol, durum)
- Filtreleme (rol, durum)
- Arama özelliği
- Pagination
- Toplu işlemler (seçili kullanıcıları aktif/pasif et)

### Kullanıcı Formu
- Modal veya ayrı sayfa
- Form validasyonu
- Loading state
- Error handling
- Success feedback

### Profil Sayfası
- Kullanıcı bilgileri kartı
- Düzenleme modu
- Şifre değiştirme bölümü
- Son giriş bilgisi
- Aktivite geçmişi

---

## Güvenlik Notları

1. **Role-Based Access Control:**
   - Sadece ADMIN rolü kullanıcı oluşturabilir, silebilir
   - Kullanıcılar kendi rollerini değiştiremez
   - Admin kendi hesabını silemez (backend kontrolü)

2. **Şifre Güvenliği:**
   - Şifre minimum 8 karakter
   - Şifre güçlülük göstergesi
   - Şifre değiştirme için mevcut şifre doğrulama

3. **Form Validasyonu:**
   - Email format kontrolü
   - Zorunlu alan kontrolü
   - Şifre eşleşme kontrolü

---

## Hata Yönetimi

**Hata Tipleri:**
- `400 Bad Request`: Geçersiz form verisi
- `401 Unauthorized`: Yetkisiz erişim
- `403 Forbidden`: Yetersiz yetki
- `404 Not Found`: Kullanıcı bulunamadı
- `409 Conflict`: Email zaten kullanılıyor

**Hata İşleme:**
- Kullanıcı dostu hata mesajları
- Form validasyon hataları form alanlarında gösterilmeli
- Network hataları için retry mekanizması

---

## Özet

Users modülü, kullanıcı yönetiminin tüm işlevlerini kapsar. Admin panelinde kullanıcı oluşturma, düzenleme, silme ve durum yönetimi yapılabilir. Kullanıcılar kendi profillerini güncelleyebilir ve şifrelerini değiştirebilir.

**Önemli Endpoint'ler:**
- `POST /users` - Kullanıcı oluşturma
- `GET /users` - Kullanıcı listesi
- `GET /users/me` - Profil bilgisi
- `PATCH /users/me` - Profil güncelleme
- `PATCH /users/me/password` - Şifre değiştirme
- `PATCH /users/:id` - Kullanıcı güncelleme (Admin)
- `DELETE /users/:id` - Kullanıcı silme (Admin)
- `POST /users/:id/activate` - Kullanıcı aktif etme (Admin)
- `POST /users/:id/deactivate` - Kullanıcı pasif etme (Admin)

**Frontend Gereksinimleri:**
- Kullanıcı listesi komponenti
- Kullanıcı formu komponenti
- Profil sayfası
- Şifre değiştirme formu
- State management (Redux)
- Form validasyonu
- Role-based access control
