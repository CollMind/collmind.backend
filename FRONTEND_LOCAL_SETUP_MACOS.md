# macOS için Local Frontend Kurulum Rehberi

Bu dokümantasyon, CollMind TPM Frontend projesini macOS bilgisayarınızda local olarak çalıştırmak için gerekli adımları içerir.

## 📋 İçindekiler

- [Gereksinimler](#gereksinimler)
- [Node.js Kurulumu](#nodejs-kurulumu)
- [Frontend Projesi Kurulumu](#frontend-projesi-kurulumu)
- [Ortam Değişkenlerini Yapılandırma](#ortam-değişkenlerini-yapılandırma)
- [Backend Bağlantısını Kontrol Etme](#backend-bağlantısını-kontrol-etme)
- [Projeyi Çalıştırma](#projeyi-çalıştırma)
- [Sorun Giderme](#sorun-giderme)

---

## Gereksinimler

Frontend projesini çalıştırmak için aşağıdaki yazılımların kurulu olması gerekir:

- **macOS** (10.15 Catalina veya üzeri)
- **Node.js** 18+ (20.x LTS önerilir)
- **npm** (Node.js ile birlikte gelir) veya **yarn** veya **pnpm**
- **Git** (projeyi klonlamak için)
- **Backend API** (çalışır durumda olmalı - backend kurulumu için `collmind.backend/LOCAL_SETUP_MACOS.md` dosyasına bakın)

---

## Node.js Kurulumu

### Adım 1: Mevcut Node.js Versiyonunu Kontrol Etme

Terminal'i açın ve aşağıdaki komutu çalıştırın:

```bash
node --version
```

Eğer Node.js kurulu değilse veya versiyon 18'den düşükse, aşağıdaki adımları takip edin.

### Adım 2: Node.js Kurulumu (nvm ile - Önerilen)

nvm (Node Version Manager) kullanarak Node.js kurulumu yapmanız önerilir. Bu yöntem, farklı Node.js versiyonlarını kolayca yönetmenizi sağlar.

#### nvm Kurulumu

Terminal'de aşağıdaki komutu çalıştırın:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
```

Kurulumdan sonra Terminal'i yeniden başlatın veya aşağıdaki komutu çalıştırın:

```bash
source ~/.zshrc
```

nvm'in kurulduğunu doğrulayın:

```bash
nvm --version
```

#### Node.js 20 LTS Kurulumu

```bash
# Node.js 20 LTS'yi kur
nvm install 20

# Node.js 20'yi aktif et
nvm use 20

# Varsayılan versiyon olarak ayarla
nvm alias default 20
```

#### Node.js Versiyonunu Doğrulama

```bash
node --version
```

Çıktı `v20.x.x` formatında olmalıdır.

```bash
npm --version
```

Çıktı `10.x.x` formatında olmalıdır.

### Alternatif: Homebrew ile Node.js Kurulumu

Eğer nvm kullanmak istemiyorsanız, Homebrew ile de kurabilirsiniz:

```bash
# Homebrew kurulumu (eğer yoksa)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 20 LTS kurulumu
brew install node@20

# PATH'e ekleme (gerekirse)
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## Frontend Projesi Kurulumu

### Adım 1: Proje Dizinine Gitme

```bash
cd /Users/tarikkinin/Projects/collmind/collmind.frontend
```

### Adım 2: Node.js Versiyonunu Kontrol Etme

```bash
node --version
```

Çıktı `v18.x.x` veya `v20.x.x` formatında olmalıdır. Eğer farklı bir versiyon varsa, yukarıdaki [Node.js Kurulumu](#nodejs-kurulumu) bölümüne bakın.

### Adım 3: Bağımlılıkları Yükleme

Proje dizininde aşağıdaki komutu çalıştırın:

```bash
npm install
```

Bu işlem:
- `package.json` dosyasındaki tüm bağımlılıkları indirir
- `node_modules` klasörünü oluşturur
- Birkaç dakika sürebilir (ilk kurulumda)

**Not**: Eğer kurulum sırasında hata alırsanız, [Sorun Giderme](#sorun-giderme) bölümüne bakın.

### Adım 4: Kurulumu Doğrulama

Kurulumun başarılı olduğunu kontrol etmek için:

```bash
# TypeScript kontrolü
npm run type-check
```

Eğer herhangi bir hata yoksa, kurulum başarılıdır.

---

## Ortam Değişkenlerini Yapılandırma

### Adım 1: .env Dosyası Oluşturma

Proje dizininde `.env` dosyası oluşturun:

```bash
cp env.example .env
```

### Adım 2: .env Dosyasını Düzenleme

`.env` dosyasını bir metin editörü ile açın ve aşağıdaki değerleri düzenleyin:

```env
# Backend API Base URL
# Local backend çalışıyorsa:
VITE_API_BASE_URL=http://localhost:3000

# Production backend kullanıyorsanız:
# VITE_API_BASE_URL=https://backend-315318338776.europe-west1.run.app

# Uygulama Bilgileri
VITE_APP_NAME=CollMind TPM
VITE_APP_VERSION=1.0.0
```

**Önemli Notlar:**
- Vite'da ortam değişkenleri `VITE_` prefix'i ile başlamalıdır
- `.env` dosyasındaki değişiklikler için development server'ı yeniden başlatmanız gerekebilir
- `.env` dosyası Git'e commit edilmemelidir (`.gitignore` içinde olmalı)

### Adım 3: Ortam Değişkenlerini Doğrulama

Ortam değişkenlerinin doğru yüklendiğini kontrol etmek için, projeyi başlattıktan sonra tarayıcı konsolunda kontrol edebilirsiniz.

---

## Backend Bağlantısını Kontrol Etme

Frontend'in çalışması için backend API'nin çalışır durumda olması gerekir.

### Adım 1: Backend'in Çalıştığını Doğrulama

Backend'in çalıştığını kontrol etmek için:

```bash
# Backend'in çalıştığını kontrol et
curl http://localhost:3000/health
```

Veya tarayıcıda `http://localhost:3000/api` adresine giderek Swagger dokümantasyonunu kontrol edebilirsiniz.

### Adım 2: Backend Kurulumu

Eğer backend çalışmıyorsa, backend kurulumu için `collmind.backend/LOCAL_SETUP_MACOS.md` dosyasına bakın.

### Adım 3: CORS Ayarları

Backend'in CORS ayarlarının frontend URL'ini (`http://localhost:5173`) içerdiğinden emin olun. Backend `.env` dosyasında:

```env
CORS_ORIGIN=http://localhost:5173
```

---

## Projeyi Çalıştırma

### Development Modu

Development server'ı başlatmak için:

```bash
npm run dev
```

Bu komut:
- Vite development server'ı başlatır
- Uygulamayı `http://localhost:5173` adresinde çalıştırır
- Hot Module Replacement (HMR) aktif olur (dosya değişikliklerinde otomatik yenilenir)
- Tarayıcı otomatik olarak açılır (vite.config.ts'de `open: true` ayarı varsa)

**Not**: Development server çalışırken terminal penceresini açık tutmanız gerekir.

### Production Preview

Production build'i test etmek için:

```bash
# Production build oluştur
npm run build

# Build'i önizle
npm run preview
```

Bu komutlar:
- TypeScript type kontrolü yapar
- Production build oluşturur (`dist/` klasörüne)
- Production build'i `http://localhost:4173` adresinde çalıştırır

### Type Checking

TypeScript type kontrolü yapmak için:

```bash
npm run type-check
```

### Linting ve Formatting

Kod kalitesi kontrolleri:

```bash
# ESLint ile kod kontrolü
npm run lint

# Prettier ile kod formatlama
npm run format
```

### Testing

Testleri çalıştırmak için:

```bash
# Tüm testleri çalıştır
npm run test

# Watch mode'da çalıştır
npm run test -- --watch

# UI ile çalıştır
npm run test:ui

# Coverage raporu
npm run test:coverage
```

---

## Sorun Giderme

### Node.js ile İlgili Sorunlar

#### Problem: "Command not found: node" veya "Command not found: npm"

**Çözüm:**
1. Node.js'in kurulu olduğunu kontrol edin: `which node`
2. Eğer kurulu değilse, [Node.js Kurulumu](#nodejs-kurulumu) bölümüne bakın
3. Terminal'i yeniden başlatın
4. PATH değişkenini kontrol edin: `echo $PATH`

#### Problem: Node.js versiyonu uyumsuz

**Çözüm:**
```bash
# nvm kullanıyorsanız
nvm install 20
nvm use 20

# Versiyonu kontrol edin
node --version
```

#### Problem: "Cannot find module" hatası

**Çözüm:**
```bash
# node_modules klasörünü silin
rm -rf node_modules

# package-lock.json'u silin (opsiyonel)
rm package-lock.json

# Bağımlılıkları yeniden yükleyin
npm install
```

#### Problem: npm install çok yavaş veya takılı kalıyor

**Çözüm:**
1. İnternet bağlantınızı kontrol edin
2. npm registry'yi kontrol edin:
   ```bash
   npm config get registry
   ```
3. npm cache'i temizleyin:
   ```bash
   npm cache clean --force
   ```
4. Alternatif olarak yarn veya pnpm kullanın:
   ```bash
   # Yarn kurulumu
   npm install -g yarn
   yarn install
   
   # veya pnpm kurulumu
   npm install -g pnpm
   pnpm install
   ```

### Vite ile İlgili Sorunlar

#### Problem: Port 5173 zaten kullanılıyor

**Çözüm:**

Port'u kullanan process'i bulun:
```bash
lsof -i :5173
```

Process'i sonlandırın:
```bash
kill -9 <PID>
```

Veya `vite.config.ts` dosyasında farklı bir port kullanın:
```typescript
server: {
  port: 5174,
}
```

#### Problem: "Failed to resolve import" hatası

**Çözüm:**
1. Import path'lerini kontrol edin
2. `vite.config.ts` dosyasındaki alias ayarlarını kontrol edin
3. Dosya yollarının doğru olduğundan emin olun
4. Development server'ı yeniden başlatın

#### Problem: HMR (Hot Module Replacement) çalışmıyor

**Çözüm:**
1. Tarayıcı konsolunda hata olup olmadığını kontrol edin
2. Development server'ı yeniden başlatın
3. Tarayıcı cache'ini temizleyin
4. Hard refresh yapın (Cmd+Shift+R)

### Backend Bağlantısı ile İlgili Sorunlar

#### Problem: "Network Error" veya "CORS Error"

**Çözüm:**
1. Backend'in çalıştığını kontrol edin:
   ```bash
   curl http://localhost:3000/health
   ```
2. `.env` dosyasındaki `VITE_API_BASE_URL` değerini kontrol edin
3. Backend'in CORS ayarlarını kontrol edin
4. Backend'i yeniden başlatın

#### Problem: "401 Unauthorized" hatası

**Çözüm:**
1. Backend'de geçerli bir kullanıcı hesabı olduğundan emin olun
2. Login işlemini tekrar deneyin
3. Tarayıcı localStorage'ı temizleyin (Developer Tools > Application > Local Storage)
4. Token'ın geçerli olduğunu kontrol edin

#### Problem: API istekleri çalışmıyor

**Çözüm:**
1. Tarayıcı Developer Tools > Network sekmesinde istekleri kontrol edin
2. Backend loglarını kontrol edin
3. `.env` dosyasındaki `VITE_API_BASE_URL` değerini doğrulayın
4. Backend'in doğru port'ta çalıştığını kontrol edin

### TypeScript ile İlgili Sorunlar

#### Problem: TypeScript hataları

**Çözüm:**
```bash
# Type kontrolü yapın
npm run type-check

# Hataları düzeltin
# IDE'nizde TypeScript hatalarını görebilirsiniz
```

#### Problem: "Cannot find module" TypeScript hatası

**Çözüm:**
1. `tsconfig.json` dosyasını kontrol edin
2. Import path'lerini kontrol edin
3. `vite.config.ts` dosyasındaki alias ayarlarını kontrol edin
4. Development server'ı yeniden başlatın

### Build ile İlgili Sorunlar

#### Problem: Build başarısız oluyor

**Çözüm:**
1. TypeScript hatalarını kontrol edin: `npm run type-check`
2. Lint hatalarını kontrol edin: `npm run lint`
3. `node_modules` klasörünü silip yeniden yükleyin
4. Build loglarını inceleyin

#### Problem: Build çıktısı çok büyük

**Çözüm:**
1. Vite otomatik olarak code splitting yapar
2. Gereksiz bağımlılıkları kontrol edin
3. Production build'de source map'leri devre dışı bırakın (vite.config.ts)

### Genel Sorunlar

#### Problem: Tarayıcıda sayfa yüklenmiyor

**Çözüm:**
1. Development server'ın çalıştığını kontrol edin
2. Tarayıcı konsolunda hataları kontrol edin
3. Network sekmesinde istekleri kontrol edin
4. Hard refresh yapın (Cmd+Shift+R)
5. Farklı bir tarayıcı deneyin

#### Problem: Stil (CSS) uygulanmıyor

**Çözüm:**
1. Tailwind CSS yapılandırmasını kontrol edin (`tailwind.config.js`)
2. `src/index.css` dosyasının import edildiğini kontrol edin
3. Development server'ı yeniden başlatın
4. Tarayıcı cache'ini temizleyin

#### Problem: Component'ler render olmuyor

**Çözüm:**
1. Tarayıcı konsolunda JavaScript hatalarını kontrol edin
2. React DevTools extension'ını kullanın
3. Component'lerin doğru import edildiğini kontrol edin
4. Development server'ı yeniden başlatın

---

## Hızlı Başlangıç Özeti

Tüm kurulumu tek seferde yapmak için:

```bash
# 1. Proje dizinine git
cd /Users/tarikkinin/Projects/collmind/collmind.frontend

# 2. Node.js versiyonunu kontrol et (18+ veya 20+ olmalı)
node --version

# 3. Bağımlılıkları yükle
npm install

# 4. .env dosyasını oluştur
cp env.example .env

# 5. .env dosyasını düzenle (VITE_API_BASE_URL'yi ayarla)
# Backend local'de çalışıyorsa: VITE_API_BASE_URL=http://localhost:3000

# 6. Backend'in çalıştığını kontrol et
curl http://localhost:3000/health

# 7. Development server'ı başlat
npm run dev
```

Tarayıcıda `http://localhost:5173` adresine giderek uygulamayı görebilirsiniz.

---

## Ek Kaynaklar

- [Vite Dokümantasyonu](https://vitejs.dev/)
- [React Dokümantasyonu](https://react.dev/)
- [TypeScript Dokümantasyonu](https://www.typescriptlang.org/)
- [Tailwind CSS Dokümantasyonu](https://tailwindcss.com/)
- [TanStack Query Dokümantasyonu](https://tanstack.com/query/latest)
- [Redux Toolkit Dokümantasyonu](https://redux-toolkit.js.org/)
- [React Router Dokümantasyonu](https://reactrouter.com/)

---

## Destek

Sorun yaşarsanız:
1. Bu dokümantasyondaki [Sorun Giderme](#sorun-giderme) bölümüne bakın
2. Proje README.md dosyasını kontrol edin
3. Backend'in çalıştığından emin olun
4. Tarayıcı konsolunda ve network sekmesinde hataları kontrol edin
5. Geliştirme ekibiyle iletişime geçin

---

**Son Güncelleme**: 2024
