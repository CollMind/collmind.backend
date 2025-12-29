# API Test Rehberi

Bu dokümantasyon, CollMind TPM Backend API'sinin tüm endpoint'lerini test etmek için adım adım rehberdir.

## 📋 İçindekiler

1. [Hazırlık](#hazırlık)
2. [Test Yöntemleri](#test-yöntemleri)
3. [Endpoint Test Senaryoları](#endpoint-test-senaryoları)
4. [Sorun Giderme](#sorun-giderme)

---

## 🚀 Hazırlık

### Adım 1: Uygulamayı Başlatma

```bash
# Development modunda başlat
npm run start:dev
```

Uygulama başladıktan sonra:
- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api
- Health Check: http://localhost:3000

### Adım 2: Veritabanını Hazırlama

```bash
# Migration'ları çalıştır
npm run migration:run

# Seeder'ları çalıştır (test verileri oluşturur)
npm run seed
```

Seeder'lar şunları oluşturur:
- **Tenant'lar:**
  - Demo Corporation (domain: demo.tsp.local)
  - Test Company (domain: test.tsp.local)

- **Kullanıcılar:**
  - admin@demo.com (password: Admin123!)
  - planner@demo.com (password: Planner123!)
  - finance@demo.com (password: Finance123!)

- **Müşteriler:** Örnek müşteri kayıtları

---

## 🧪 Test Yöntemleri

### Yöntem 1: Swagger UI (Önerilen - Başlangıç için)

**Avantajlar:**
- ✅ Tarayıcıdan direkt test
- ✅ Tüm endpoint'leri görsel olarak görebilme
- ✅ Request/Response örnekleri
- ✅ Authentication kolayca yapılabilir

**Kullanım:**
1. Tarayıcıda http://localhost:3000/api adresine git
2. "Authorize" butonuna tıkla
3. Login endpoint'ini kullanarak token al
4. Token'ı "Authorize" kısmına yapıştır
5. İstediğin endpoint'i test et

**Örnek Login:**
```json
POST /api/auth/login
{
  "email": "admin@demo.com",
  "password": "Admin123!"
}
```

### Yöntem 2: HTTP Dosyaları (VS Code REST Client)

**Avantajlar:**
- ✅ Kod editöründen direkt test
- ✅ Değişkenler kullanılabilir
- ✅ Request'leri kaydedebilme
- ✅ Hızlı test için ideal

**Kullanım:**
1. VS Code'da `tests/api/` klasöründeki `.http` dosyalarını aç
2. REST Client extension'ı yükle (eğer yoksa)
3. Her request'in üzerindeki "Send Request" butonuna tıkla

**Dosyalar:**
- `tests/api/users.http` - User endpoint'leri
- `tests/api/tenants.http` - Tenant endpoint'leri
- `tests/api/customers.http` - Customer endpoint'leri

### Yöntem 3: Postman / Insomnia

**Avantajlar:**
- ✅ Collection'lar oluşturulabilir
- ✅ Environment variables
- ✅ Test scriptleri yazılabilir
- ✅ Otomasyon için ideal

**Kullanım:**
1. Postman/Insomnia'yı aç
2. Yeni collection oluştur
3. Environment variables ekle:
   - `baseUrl`: http://localhost:3000/api
   - `token`: (login sonrası)
   - `tenantId`: (tenant ID)

---

## 📝 Endpoint Test Senaryoları

### 🔐 Authentication Endpoints

#### 1. Login
```http
POST /api/auth/login
Content-Type: application/json
x-tenant-id: <tenant-id> (opsiyonel)

{
  "email": "admin@demo.com",
  "password": "Admin123!"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "...",
  "user": {
    "id": "...",
    "email": "admin@demo.com",
    "role": "ADMIN"
  }
}
```

**Not:** Token'ı kaydedin, diğer request'lerde kullanacaksınız.

#### 2. Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<refresh-token>"
}
```

#### 3. Logout
```http
POST /api/auth/logout
Authorization: Bearer <access-token>
```

---

### 👥 User Endpoints

**Önkoşul:** Admin token'ı gerekli (çoğu endpoint için)

#### 1. Kullanıcı Oluştur
```http
POST /api/users
Authorization: Bearer <admin-token>
Content-Type: application/json
x-tenant-id: <tenant-id>

{
  "email": "newuser@demo.com",
  "password": "NewUser123!",
  "fullName": "New User",
  "firstName": "New",
  "lastName": "User",
  "role": "PLANNER",
  "status": "ACTIVE",
  "phoneNumber": "+90 555 999 8888",
  "department": "Sales",
  "jobTitle": "Junior Planner"
}
```

#### 2. Tüm Kullanıcıları Listele
```http
GET /api/users
Authorization: Bearer <admin-token>
x-tenant-id: <tenant-id>
```

#### 3. Kullanıcı Detayı
```http
GET /api/users/<user-id>
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 4. Kendi Profilini Görüntüle
```http
GET /api/users/me
Authorization: Bearer <token>
```

#### 5. Profil Güncelle
```http
PATCH /api/users/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "fullName": "Updated Name",
  "phoneNumber": "+90 555 111 2222"
}
```

#### 6. Kullanıcı Güncelle (Admin)
```http
PATCH /api/users/<user-id>
Authorization: Bearer <admin-token>
Content-Type: application/json
x-tenant-id: <tenant-id>

{
  "status": "ACTIVE",
  "department": "Marketing"
}
```

#### 7. Şifre Değiştir (Kendi)
```http
PATCH /api/users/me/password
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

#### 8. Kullanıcı Aktifleştir
```http
POST /api/users/<user-id>/activate
Authorization: Bearer <admin-token>
x-tenant-id: <tenant-id>
```

#### 9. Kullanıcı Deaktifleştir
```http
POST /api/users/<user-id>/deactivate
Authorization: Bearer <admin-token>
x-tenant-id: <tenant-id>
```

#### 10. Kullanıcı Sil (Soft Delete)
```http
DELETE /api/users/<user-id>
Authorization: Bearer <admin-token>
x-tenant-id: <tenant-id>
```

---

### 🏢 Tenant Endpoints

**Önkoşul:** Admin token'ı gerekli

#### 1. Tenant Oluştur
```http
POST /api/tenants
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "New Test Company",
  "domain": "newtest.tsp.local",
  "status": "TRIAL",
  "plan": "BASIC",
  "contactEmail": "admin@newtest.com",
  "contactPerson": "Test Admin",
  "city": "Istanbul",
  "country": "Turkey"
}
```

#### 2. Tüm Tenant'ları Listele
```http
GET /api/tenants
Authorization: Bearer <admin-token>
```

#### 3. Tenant Detayı
```http
GET /api/tenants/<tenant-id>
Authorization: Bearer <token>
```

#### 4. Tenant Güncelle
```http
PATCH /api/tenants/<tenant-id>
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "status": "ACTIVE",
  "plan": "PROFESSIONAL"
}
```

#### 5. Tenant Aktifleştir
```http
POST /api/tenants/<tenant-id>/activate
Authorization: Bearer <admin-token>
```

#### 6. Tenant Askıya Al
```http
POST /api/tenants/<tenant-id>/suspend
Authorization: Bearer <admin-token>
```

#### 7. Tenant İstatistikleri
```http
GET /api/tenants/<tenant-id>/stats
Authorization: Bearer <token>
```

#### 8. Tenant Sil
```http
DELETE /api/tenants/<tenant-id>
Authorization: Bearer <admin-token>
```

---

### 🛒 Customer Endpoints

**Önkoşul:** Token ve x-tenant-id header'ı gerekli

#### 1. Müşteri Oluştur
```http
POST /api/customers
Authorization: Bearer <token>
Content-Type: application/json
x-tenant-id: <tenant-id>

{
  "code": "CUST001",
  "name": "Metro Türkiye",
  "channel": "NKA",
  "type": "DIRECT",
  "status": "ACTIVE",
  "city": "Istanbul",
  "district": "Beşiktaş",
  "country": "Turkey",
  "contactPerson": "Ahmet Yılmaz",
  "contactEmail": "ahmet.yilmaz@metro.com.tr",
  "contactPhone": "+90 212 555 1234",
  "paymentTerms": "NET30",
  "creditLimit": 500000,
  "currency": "TRY",
  "isVip": true
}
```

#### 2. Toplu Müşteri Oluştur
```http
POST /api/customers/bulk
Authorization: Bearer <token>
Content-Type: application/json
x-tenant-id: <tenant-id>

{
  "customers": [
    {
      "code": "CUST002",
      "name": "Migros",
      "channel": "NKA",
      "type": "DIRECT",
      "city": "Istanbul"
    },
    {
      "code": "CUST003",
      "name": "CarrefourSA",
      "channel": "NKA",
      "type": "DIRECT",
      "city": "Istanbul"
    }
  ]
}
```

#### 3. Tüm Müşterileri Listele
```http
GET /api/customers
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 4. Filtreli Müşteri Listesi
```http
GET /api/customers?channel=NKA&city=Istanbul&status=ACTIVE
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 5. Sayfalama ile Müşteri Listesi
```http
GET /api/customers?page=1&limit=10&sortBy=name&sortOrder=ASC
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 6. Müşteri Ara
```http
GET /api/customers/search?q=Metro
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 7. Müşteri Detayı (ID ile)
```http
GET /api/customers/<customer-id>
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 8. Müşteri Detayı (Code ile)
```http
GET /api/customers/code/CUST001
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 9. Müşteri Güncelle
```http
PATCH /api/customers/<customer-id>
Authorization: Bearer <token>
Content-Type: application/json
x-tenant-id: <tenant-id>

{
  "status": "ACTIVE",
  "customerTier": "A+",
  "creditLimit": 750000
}
```

#### 10. Kanal Bazlı Müşteriler
```http
GET /api/customers/channel/NKA
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 11. Şehir Bazlı Müşteriler
```http
GET /api/customers/city/Istanbul
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 12. VIP Müşteriler
```http
GET /api/customers/vip
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 13. Müşteri İstatistikleri
```http
GET /api/customers/<customer-id>/stats
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 14. Müşteri Aktifleştir
```http
POST /api/customers/<customer-id>/activate
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 15. Müşteri Deaktifleştir
```http
POST /api/customers/<customer-id>/deactivate
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

#### 16. Müşteri Sil
```http
DELETE /api/customers/<customer-id>
Authorization: Bearer <token>
x-tenant-id: <tenant-id>
```

---

## 🔄 Test Senaryosu Örneği

### Senaryo: Yeni Müşteri İş Akışı

1. **Login yap**
   ```http
   POST /api/auth/login
   {
     "email": "planner@demo.com",
     "password": "Planner123!"
   }
   ```
   → Token'ı kaydet

2. **Tenant ID'yi al**
   - Login response'undan veya
   - GET /api/users/me endpoint'inden

3. **Yeni müşteri oluştur**
   ```http
   POST /api/customers
   Authorization: Bearer <token>
   x-tenant-id: <tenant-id>
   {
     "code": "CUST999",
     "name": "Test Müşteri",
     "channel": "NKA"
   }
   ```
   → Customer ID'yi kaydet

4. **Müşteriyi görüntüle**
   ```http
   GET /api/customers/<customer-id>
   Authorization: Bearer <token>
   x-tenant-id: <tenant-id>
   ```

5. **Müşteriyi güncelle**
   ```http
   PATCH /api/customers/<customer-id>
   Authorization: Bearer <token>
   x-tenant-id: <tenant-id>
   {
     "status": "ACTIVE",
     "isVip": true
   }
   ```

6. **Müşteri istatistiklerini görüntüle**
   ```http
   GET /api/customers/<customer-id>/stats
   Authorization: Bearer <token>
   x-tenant-id: <tenant-id>
   ```

---

## ⚠️ Sorun Giderme

### Problem: 401 Unauthorized
**Çözüm:**
- Token'ın geçerli olduğundan emin ol
- Token'ın süresi dolmuş olabilir, yeniden login yap
- Authorization header'ını kontrol et: `Bearer <token>`

### Problem: 403 Forbidden
**Çözüm:**
- Endpoint için gerekli role sahip olduğundan emin ol
- Admin işlemleri için admin@demo.com ile login yap

### Problem: 404 Not Found
**Çözüm:**
- ID'lerin doğru olduğundan emin ol
- x-tenant-id header'ını ekle (customer ve user endpoint'leri için)

### Problem: 409 Conflict
**Çözüm:**
- Unique constraint ihlali (örn: email, customer code)
- Farklı bir değer kullan

### Problem: 400 Bad Request
**Çözüm:**
- Request body'yi kontrol et
- Gerekli alanların doldurulduğundan emin ol
- Validation hatalarını response'da kontrol et

### Problem: Database Connection Error
**Çözüm:**
```bash
# Docker container'ı kontrol et
docker-compose ps

# Container'ı başlat
docker-compose up -d

# Migration'ları çalıştır
npm run migration:run
```

---

## 📊 Test Checklist

### Authentication
- [ ] Login (başarılı)
- [ ] Login (hatalı şifre)
- [ ] Refresh token
- [ ] Logout

### Users
- [ ] Kullanıcı oluştur
- [ ] Kullanıcı listele
- [ ] Kullanıcı detayı
- [ ] Profil görüntüle
- [ ] Profil güncelle
- [ ] Şifre değiştir
- [ ] Kullanıcı aktifleştir/deaktifleştir
- [ ] Kullanıcı sil

### Tenants
- [ ] Tenant oluştur
- [ ] Tenant listele
- [ ] Tenant detayı
- [ ] Tenant güncelle
- [ ] Tenant aktifleştir/askıya al
- [ ] Tenant istatistikleri
- [ ] Tenant sil

### Customers
- [ ] Müşteri oluştur
- [ ] Toplu müşteri oluştur
- [ ] Müşteri listele
- [ ] Filtreli listele
- [ ] Müşteri ara
- [ ] Müşteri detayı (ID)
- [ ] Müşteri detayı (Code)
- [ ] Müşteri güncelle
- [ ] Kanal bazlı listele
- [ ] Şehir bazlı listele
- [ ] VIP müşteriler
- [ ] Müşteri istatistikleri
- [ ] Müşteri aktifleştir/deaktifleştir
- [ ] Müşteri sil

---

## 🎯 Hızlı Başlangıç Komutları

```bash
# 1. Uygulamayı başlat
npm run start:dev

# 2. Başka bir terminal'de migration ve seed çalıştır
npm run migration:run
npm run seed

# 3. Swagger UI'ı aç
# Tarayıcıda: http://localhost:3000/api

# 4. Test verileri ile login
# Email: admin@demo.com
# Password: Admin123!
```

---

## 📚 Ek Kaynaklar

- **Swagger UI:** http://localhost:3000/api
- **HTTP Test Dosyaları:** `tests/api/` klasörü
- **API Base URL:** http://localhost:3000/api

---

**Not:** Tüm endpoint'ler JWT authentication gerektirir (login hariç). Token'ı her request'te `Authorization: Bearer <token>` header'ı ile gönderin.

