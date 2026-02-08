# Frontend React.js - Authentication Modülü

## Genel Bakış

Authentication modülü, kullanıcıların sisteme giriş yapması, token yenileme ve çıkış yapması için gerekli tüm endpoint'leri ve frontend entegrasyon mantığını içerir.

## Endpoint'ler

### POST `/auth/login`
**Açıklama:** Kullanıcı girişi ve token alımı

**Request Body:**
```typescript
{
  email: string;          // Zorunlu, geçerli email formatı
  password: string;       // Zorunlu, minimum 8 karakter
  ipAddress?: string;     // Opsiyonel, istemci IP adresi
}
```

**Response (200 OK):**
```typescript
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';
    tenantId: string;
  };
}
```

**Hata Yanıtları:**
- `401 Unauthorized`: Geçersiz kimlik bilgileri

**Çalışma Mantığı:**
1. Kullanıcı email ve şifre ile giriş yapar
2. Backend kullanıcıyı doğrular ve JWT token'lar oluşturur
3. Access token ve refresh token döner
4. Frontend token'ları localStorage veya sessionStorage'da saklar
5. Sonraki isteklerde Authorization header'ında Bearer token gönderilir

**Frontend Kullanım Senaryosu:**
- Login sayfasında form gönderildiğinde çağrılır
- Başarılı girişte token'lar saklanır ve kullanıcı dashboard'a yönlendirilir
- Hata durumunda kullanıcıya uygun mesaj gösterilir

---

### POST `/auth/refresh`
**Açıklama:** Access token'ı refresh token ile yenileme

**Request Body:**
```typescript
{
  refreshToken: string;
}
```

**Response (200 OK):**
```typescript
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
  };
}
```

**Hata Yanıtları:**
- `401 Unauthorized`: Geçersiz refresh token

**Çalışma Mantığı:**
1. Access token süresi dolduğunda otomatik olarak çağrılır
2. Refresh token ile yeni access token alınır
3. Yeni token'lar saklanır ve istek tekrar edilir
4. Refresh token da geçersizse kullanıcı login sayfasına yönlendirilir

**Frontend Kullanım Senaryosu:**
- Axios interceptor ile otomatik token yenileme
- 401 hatası alındığında otomatik refresh işlemi
- Refresh token da geçersizse logout işlemi

---

### POST `/auth/logout`
**Açıklama:** Kullanıcı çıkışı (refresh token'ı geçersiz kılar)

**Headers:** 
```
Authorization: Bearer {accessToken}
```

**Response:** `204 No Content`

**Çalışma Mantığı:**
1. Kullanıcı logout butonuna tıklar
2. Backend refresh token'ı geçersiz kılar
3. Frontend token'ları temizler
4. Kullanıcı login sayfasına yönlendirilir

**Frontend Kullanım Senaryosu:**
- Header'daki logout butonuna tıklandığında çağrılır
- Token'lar localStorage'dan silinir
- Redux store temizlenir
- Login sayfasına yönlendirilir

---

## Frontend Entegrasyon Detayları

### API Service Yapısı

**Dosya Yapısı:**
```
src/
  services/
    api/
      auth.service.ts
      apiClient.ts
  hooks/
    useAuth.ts
  store/
    auth/
      authSlice.ts
```

### Axios Interceptor Yapılandırması

**Çalışma Mantığı:**
1. Her istekte Authorization header'ına access token eklenir
2. 401 hatası alındığında otomatik token refresh denenir
3. Refresh başarısızsa kullanıcı logout edilir
4. Token yenilendikten sonra orijinal istek tekrar edilir

**Önemli Noktalar:**
- Token refresh sırasında diğer istekler bekletilmeli (queue mekanizması)
- Refresh token rotation: Yeni refresh token da saklanmalı
- Token'lar güvenli şekilde saklanmalı (httpOnly cookie tercih edilebilir)

### State Management

**Redux Store Yapısı:**
```typescript
{
  auth: {
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
  }
}
```

**Actions:**
- `login`: Giriş yapma
- `logout`: Çıkış yapma
- `refreshToken`: Token yenileme
- `setUser`: Kullanıcı bilgilerini güncelleme
- `clearError`: Hata mesajını temizleme

### React Hook Kullanımı

**useAuth Hook:**
- `login(email, password)`: Giriş yapma
- `logout()`: Çıkış yapma
- `refreshToken()`: Token yenileme
- `isAuthenticated`: Giriş durumu kontrolü
- `user`: Mevcut kullanıcı bilgileri

### Route Protection

**Private Route Yapısı:**
- Giriş yapmamış kullanıcılar korumalı sayfalara erişemez
- Token kontrolü yapılır
- Geçersiz token durumunda login sayfasına yönlendirilir

**Role-Based Route Protection:**
- Kullanıcı rolüne göre sayfa erişimi kontrol edilir
- Yetkisiz sayfalara erişim engellenir

---

## Kullanım Senaryoları

### Senaryo 1: Kullanıcı Girişi
1. Kullanıcı login sayfasına gelir
2. Email ve şifre girer
3. Form submit edilir
4. `POST /auth/login` çağrılır
5. Başarılıysa token'lar saklanır ve dashboard'a yönlendirilir
6. Hatalıysa hata mesajı gösterilir

### Senaryo 2: Otomatik Token Yenileme
1. Kullanıcı bir API isteği yapar
2. Access token süresi dolmuştur (401 hatası)
3. Axios interceptor devreye girer
4. `POST /auth/refresh` çağrılır
5. Yeni token'lar alınır ve saklanır
6. Orijinal istek yeni token ile tekrar edilir

### Senaryo 3: Kullanıcı Çıkışı
1. Kullanıcı logout butonuna tıklar
2. `POST /auth/logout` çağrılır
3. Token'lar localStorage'dan silinir
4. Redux store temizlenir
5. Login sayfasına yönlendirilir

### Senaryo 4: Sayfa Yenileme Sonrası Oturum Kontrolü
1. Kullanıcı sayfayı yeniler
2. Uygulama başlangıcında localStorage'dan token kontrol edilir
3. Token varsa `GET /users/me` ile kullanıcı bilgileri alınır
4. Token geçersizse login sayfasına yönlendirilir

---

## Güvenlik Notları

1. **Token Saklama:**
   - localStorage: XSS saldırılarına açık
   - sessionStorage: Sekme kapatıldığında silinir
   - httpOnly Cookie: En güvenli yöntem (XSS'e karşı korumalı)

2. **Token Süresi:**
   - Access token: Kısa süreli (15-30 dakika)
   - Refresh token: Uzun süreli (7-30 gün)

3. **CSRF Koruması:**
   - Token'lar header'da gönderilmeli (cookie'de değil)
   - CORS ayarları doğru yapılandırılmalı

4. **XSS Koruması:**
   - Tüm kullanıcı girdileri sanitize edilmeli
   - Content Security Policy (CSP) kullanılmalı

---

## Hata Yönetimi

**Hata Tipleri:**
- `401 Unauthorized`: Geçersiz kimlik bilgileri veya token
- `403 Forbidden`: Yetkisiz erişim
- `500 Internal Server Error`: Sunucu hatası
- `Network Error`: Ağ bağlantı hatası

**Hata İşleme Stratejisi:**
- Kullanıcı dostu hata mesajları gösterilmeli
- Teknik hata detayları log'lanmalı ama kullanıcıya gösterilmemeli
- Retry mekanizması kritik işlemler için düşünülmeli

---

## Test Senaryoları

1. **Başarılı Giriş:** Geçerli kimlik bilgileri ile giriş
2. **Başarısız Giriş:** Geçersiz kimlik bilgileri ile giriş
3. **Token Yenileme:** Access token süresi dolduğunda otomatik yenileme
4. **Logout:** Çıkış yapma ve token temizleme
5. **Sayfa Yenileme:** Token ile oturum devam ettirme
6. **Yetkisiz Erişim:** Token olmadan korumalı sayfaya erişim

---

## Özet

Authentication modülü, uygulamanın güvenlik katmanının temelini oluşturur. Tüm endpoint'ler doğru şekilde entegre edilmeli ve güvenlik best practice'leri uygulanmalıdır.

**Önemli Endpoint'ler:**
- `POST /auth/login` - Kullanıcı girişi
- `POST /auth/refresh` - Token yenileme
- `POST /auth/logout` - Kullanıcı çıkışı

**Frontend Gereksinimleri:**
- Axios interceptor yapılandırması
- Token saklama mekanizması
- Route protection
- State management (Redux)
- Error handling
