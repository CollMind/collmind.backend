# macOS için Local Backend Kurulum Rehberi

Bu dokümantasyon, CollMind TPM Backend projesini macOS bilgisayarınızda local olarak çalıştırmak için gerekli adımları içerir.

## 📋 İçindekiler

- [Gereksinimler](#gereksinimler)
- [Docker Desktop Kurulumu](#docker-desktop-kurulumu)
- [PostgreSQL Kurulumu](#postgresql-kurulumu)
  - [Yöntem 1: Docker ile PostgreSQL (Önerilen)](#yöntem-1-docker-ile-postgresql-önerilen)
  - [Yöntem 2: Homebrew ile Native PostgreSQL](#yöntem-2-homebrew-ile-native-postgresql)
- [Backend Projesi Kurulumu](#backend-projesi-kurulumu)
- [Veritabanı Yapılandırması](#veritabanı-yapılandırması)
- [Projeyi Çalıştırma](#projeyi-çalıştırma)
- [Sorun Giderme](#sorun-giderme)

---

## Gereksinimler

Backend projesini çalıştırmak için aşağıdaki yazılımların kurulu olması gerekir:

- **macOS** (10.15 Catalina veya üzeri)
- **Node.js** 20.x LTS
- **npm** veya **yarn**
- **Docker Desktop** (PostgreSQL için)
- **Git** (projeyi klonlamak için)

---

## Docker Desktop Kurulumu

### Adım 1: Docker Desktop İndirme

1. [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) sayfasına gidin
2. Bilgisayarınızın işlemci mimarisine göre uygun versiyonu seçin:
   - **Apple Silicon (M1/M2/M3)**: Apple Silicon için
   - **Intel**: Intel işlemcili Mac'ler için
3. `.dmg` dosyasını indirin

### Adım 2: Docker Desktop Kurulumu

1. İndirilen `.dmg` dosyasını açın
2. Docker ikonunu `Applications` klasörüne sürükleyin
3. `Applications` klasöründen Docker'ı başlatın
4. İlk açılışta sistem izinleri istenebilir - izin verin
5. Docker Desktop menü çubuğunda görünene kadar bekleyin (yaklaşık 1-2 dakika)

### Adım 3: Docker Kurulumunu Doğrulama

Terminal'i açın ve aşağıdaki komutu çalıştırın:

```bash
docker --version
```

Çıktı şuna benzer olmalıdır:
```
Docker version 24.0.0, build abc123
```

Docker Compose'u kontrol edin:

```bash
docker compose version
```

Çıktı şuna benzer olmalıdır:
```
Docker Compose version v2.20.0
```

### Adım 4: Docker Desktop Ayarları (Opsiyonel)

1. Docker Desktop menü çubuğundaki ikona tıklayın
2. **Settings** (Ayarlar) > **Resources** bölümüne gidin
3. **Memory** ayarını en az **4GB** olarak ayarlayın (önerilen: 8GB)
4. **Disk image size** ayarını kontrol edin (en az 20GB önerilir)
5. **Apply & Restart** butonuna tıklayın

---

## PostgreSQL Kurulumu

PostgreSQL'i kurmak için iki yöntem mevcuttur. **Docker yöntemi önerilir** çünkü daha kolay yönetilir ve sisteminizi kirletmez.

### Yöntem 1: Docker ile PostgreSQL (Önerilen)

Bu yöntem, PostgreSQL'i Docker container'ı olarak çalıştırır. Sisteminize doğrudan kurulum yapmaz.

#### Adım 1: Proje Dizinine Gitme

```bash
cd /Users/tarikkinin/Projects/collmind/collmind.backend
```

#### Adım 2: Docker Compose ile PostgreSQL Başlatma

Proje dizininde aşağıdaki komutu çalıştırın:

```bash
docker compose up -d postgres
```

Bu komut:
- PostgreSQL 16.x image'ını indirir (ilk seferinde)
- `collmind-tpm-postgres` adında bir container oluşturur
- PostgreSQL'i port 5432'de başlatır
- Veritabanı şemasını (`main`) otomatik olarak oluşturur

#### Adım 3: PostgreSQL Container Durumunu Kontrol Etme

```bash
docker compose ps
```

Çıktı şuna benzer olmalıdır:
```
NAME                        STATUS              PORTS
collmind-tpm-postgres       Up (healthy)        0.0.0.0:5432->5432/tcp
```

#### Adım 4: PostgreSQL Loglarını Görüntüleme

Container'ın düzgün çalıştığını kontrol etmek için:

```bash
docker compose logs postgres
```

#### Adım 5: PostgreSQL'e Bağlanma (Opsiyonel)

Container içindeki PostgreSQL'e bağlanmak için:

```bash
docker compose exec postgres psql -U app_operator -d collmind_tpm  # K1a/Z52 §4: insan-yolu app_operator'dür, postgres DEĞİL
```

PostgreSQL prompt'u görünecektir. Çıkmak için `\q` yazın.

#### PostgreSQL Container Yönetimi

**Container'ı durdurmak:**
```bash
docker compose stop postgres
```

**Container'ı başlatmak:**
```bash
docker compose start postgres
```

**Container'ı durdurup silmek (veriler korunur):**
```bash
docker compose down
```

**Container'ı durdurup tüm verileri silmek:**
```bash
docker compose down -v
```

⚠️ **Uyarı**: `-v` parametresi ile tüm veritabanı verileri silinir!

---

### Yöntem 2: Homebrew ile Native PostgreSQL

Eğer Docker kullanmak istemiyorsanız, PostgreSQL'i sisteminize doğrudan kurabilirsiniz.

#### Adım 1: Homebrew Kurulumu

Homebrew yüklü değilse, Terminal'de şu komutu çalıştırın:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Adım 2: PostgreSQL Kurulumu

```bash
brew install postgresql@16
```

#### Adım 3: PostgreSQL Servisini Başlatma

```bash
brew services start postgresql@16
```

#### Adım 4: PostgreSQL'e Bağlanma ve Veritabanı Oluşturma

```bash
# PostgreSQL'e bağlan
psql postgres

# Veritabanını oluştur
CREATE DATABASE collmind_tpm;

# Şemayı oluştur
\c collmind_tpm
CREATE SCHEMA IF NOT EXISTS main;
GRANT ALL PRIVILEGES ON SCHEMA main TO postgres;

# Çıkış
\q
```

#### Adım 5: PostgreSQL Servis Yönetimi

**Servisi durdurmak:**
```bash
brew services stop postgresql@16
```

**Servisi başlatmak:**
```bash
brew services start postgresql@16
```

**Servis durumunu kontrol etmek:**
```bash
brew services list
```

---

## Backend Projesi Kurulumu

### Adım 1: Proje Dizinine Gitme

```bash
cd /Users/tarikkinin/Projects/collmind/collmind.backend
```

### Adım 2: Node.js Versiyonunu Kontrol Etme

```bash
node --version
```

Çıktı `v20.x.x` formatında olmalıdır. Eğer farklı bir versiyon varsa, [nvm](https://github.com/nvm-sh/nvm) kullanarak Node.js 20'yi kurun:

```bash
# nvm kurulumu (eğer yoksa)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Terminal'i yeniden başlatın veya:
source ~/.zshrc

# Node.js 20 LTS kurulumu
nvm install 20
nvm use 20
```

### Adım 3: Bağımlılıkları Yükleme

```bash
npm install
```

Bu işlem birkaç dakika sürebilir.

### Adım 4: Ortam Değişkenlerini Yapılandırma

`.env` dosyası oluşturun:

```bash
cp .env.example .env
```

Eğer `.env.example` dosyası yoksa, aşağıdaki içeriği kullanarak `.env` dosyası oluşturun:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
# Docker kullanıyorsanız:
DB_HOST=localhost
# Native PostgreSQL kullanıyorsanız:
# DB_HOST=localhost

DB_PORT=5432
DB_DATABASE=collmind_tpm
DB_SCHEMA=main

# K-2.6.13: iki AYRI, AYRICALIKSIZ bağlantı rolü — tek 'postgres' kimliği
# artık kullanılmıyor. Parolaları kendiniz seçin, sonra "Veritabanı
# Yapılandırması" bölümündeki Adım 1a ile rolleri DB'de yaratın.
DB_RUNTIME_USERNAME=app_runtime
DB_RUNTIME_PASSWORD=<yerel-parola-seçin>
DB_MIGRATE_USERNAME=app_migrate
DB_MIGRATE_PASSWORD=<yerel-parola-seçin>

# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=1d
```

⚠️ **Önemli**: Production ortamında `JWT_SECRET` değerini mutlaka güçlü bir değerle değiştirin!

⚠️ **`DB_USERNAME`/`DB_PASSWORD` artık okunmuyor** (K-2.6.13). Uygulama ve CLI
komutları `DB_RUNTIME_*`/`DB_MIGRATE_*` olmadan AÇIK HATA ile durur — sessizce
ayrıcalıklı bir role düşmez.

---

## Veritabanı Yapılandırması

### Adım 1: PostgreSQL'in Çalıştığını Doğrulama

**Docker kullanıyorsanız:**
```bash
docker compose ps postgres
```

**Native PostgreSQL kullanıyorsanız:**
```bash
brew services list | grep postgresql
```

### Adım 1a: Veritabanı Rollerini Kurma (K-2.6.13 — ZORUNLU, idempotent)

Migration'lardan ÖNCE çalıştırılmalıdır — `npm run migration:run` artık
ayrıcalıksız `app_migrate` rolüyle koşar, ve bu rol bu adımda yaratılır.
Tekrar çalıştırmak güvenlidir (roller yoksa yaratır, varsa parolayı/
özniteliklerini yeniden uygular).

```bash
DB_RUNTIME_PASSWORD=<.env'deki DB_RUNTIME_PASSWORD> \
DB_MIGRATE_PASSWORD=<.env'deki DB_MIGRATE_PASSWORD> \
  bash scripts/db-roles-setup.sh
```

Bu betik:
- `app_runtime` rolünü yaratır — uygulamanın çalışma zamanı bağlantısı (DML,
  RLS'e tabi, DDL yok, hiçbir tablonun sahibi değil).
- `app_migrate` rolünü yaratır — migration/seed bağlantısı (DDL yetkili,
  tablo sahibi).
- Var olan tüm tabloların/sequence'ların/view'ların/enum-domain tiplerinin/
  fonksiyonların sahipliğini `app_migrate`'e taşır (yerel DB'de daha önce
  `postgres` ile yaratılmış olabilirler). Enum sahipliği önemlidir: bir
  `ALTER TYPE ... ADD VALUE` göçü (ör. yeni bir rol eklemek) sahiplik
  ister — yalnız `USAGE` yetmez.

Bu adım atlanırsa `migration:run`/`seed`/`start:dev` bağlantı kimliği
eksik hatasıyla durur (K-2.6.13d: sessiz geri dönüş yok, ayrıcalıklı
`postgres`'e düşülmez).

⚠️ Bu adım **yalnız rolleri ve sahipliği** kurar — `app_runtime`'ın tablo/
sütun bazlı GRANT'leri BURADA YOK. O adım migration'lardan SONRA gelir
(`Adım 2a`, aşağıda) — GRANT verdiği tabloların önce var olması gerekir.

### Adım 2: Migration'ları Çalıştırma

Veritabanı şemasını oluşturmak için migration'ları çalıştırın:

```bash
npm run migration:run
```

Bu komut:
- Tüm migration dosyalarını çalıştırır
- Veritabanı tablolarını oluşturur
- Gerekli indeksleri ve constraint'leri ekler

### Adım 2a: `app_runtime` GRANT Setini Uygulama (K-2.6.13f — ZORUNLU, idempotent)

Migration'lardan SONRA çalıştırılmalıdır — bu adım `app_runtime`'ın (uygulamanın
çalışma zamanı rolü) tablo/sütun bazlı GRANT'lerini uygular ve GRANT verdiği
tabloların VAR OLMASINI gerektirir. `Adım 1a`'nın tersine, migration'lardan
ÖNCE çalıştırılırsa "relation ... does not exist" ile düşer.

```bash
npm run db:roles:grants
npm run db:roles:operator-grants   # 4. adım — K1a: app_operator GRANT'leri (Z52 §3)
```

Tekrar çalıştırmak güvenlidir VE YAKINSAKTIR: betik önce `app_runtime`'ın tüm
nesne haklarını geri alır (`REVOKE ALL`), sonra ölçülmüş asgari seti yeniden
kurar — elle verilmiş fazladan bir hak bir sonraki koşumda geri alınır.

Bu adım atlanırsa uygulama ve e2e testleri `permission denied for table ...`
hatalarıyla durur.

### Adım 3: Seed Verilerini Yükleme (Opsiyonel)

Test verilerini yüklemek için:

```bash
npm run seed:run
```

Sadece temel verileri yükler. Tüm seed verilerini temizleyip yeniden yüklemek için:

```bash
npm run seed:cleanup-and-seed
```

---

## Projeyi Çalıştırma

### Development Modu

```bash
npm run start:dev
```

Bu komut:
- Projeyi watch mode'da başlatır (dosya değişikliklerinde otomatik yeniden başlar)
- API'yi `http://localhost:3000` adresinde çalıştırır
- Swagger dokümantasyonunu `http://localhost:3000/api` adresinde erişilebilir yapar

### Production Modu

```bash
# Önce projeyi derleyin
npm run build

# Sonra production modunda çalıştırın
npm run start:prod
```

### Debug Modu

```bash
npm run start:debug
```

---

## Sorun Giderme

### Docker ile İlgili Sorunlar

#### Problem: Docker Desktop başlamıyor

**Çözüm:**
1. Docker Desktop'ı tamamen kapatın (menü çubuğundan Quit)
2. Sistem Tercihleri > Güvenlik ve Gizlilik > Tam Disk Erişimi bölümünde Docker'ın izinleri olduğundan emin olun
3. Docker Desktop'ı yeniden başlatın
4. Hala sorun varsa, Docker Desktop'ı yeniden yükleyin

#### Problem: Port 5432 zaten kullanılıyor

**Çözüm:**

Port'u kullanan process'i bulun:
```bash
lsof -i :5432
```

Process'i sonlandırın:
```bash
kill -9 <PID>
```

Veya Docker Compose dosyasında farklı bir port kullanın (örn: 5433):
```yaml
ports:
  - '5433:5432'
```

Ve `.env` dosyasında da portu güncelleyin:
```env
DB_PORT=5433
```

#### Problem: PostgreSQL container'ı sağlıksız (unhealthy)

**Çözüm:**
```bash
# Container loglarını kontrol edin
docker compose logs postgres

# Container'ı yeniden başlatın
docker compose restart postgres

# Hala sorun varsa, container'ı silip yeniden oluşturun
docker compose down
docker compose up -d postgres
```

### PostgreSQL ile İlgili Sorunlar

#### Problem: "Connection refused" hatası

**Çözüm:**

**Docker kullanıyorsanız:**
- Container'ın çalıştığını kontrol edin: `docker compose ps`
- Container'ı başlatın: `docker compose start postgres`

**Native PostgreSQL kullanıyorsanız:**
- Servisin çalıştığını kontrol edin: `brew services list`
- Servisi başlatın: `brew services start postgresql@16`

#### Problem: "Database does not exist" hatası

**Çözüm:**

Veritabanını oluşturun:
```bash
# Docker kullanıyorsanız
docker compose exec postgres psql -U postgres -c "CREATE DATABASE collmind_tpm;"

# Native PostgreSQL kullanıyorsanız
createdb collmind_tpm
```

#### Problem: "Schema does not exist" hatası

**Çözüm:**

Şemayı oluşturun:
```bash
# Docker kullanıyorsanız
docker compose exec postgres psql -U postgres -d collmind_tpm -c "CREATE SCHEMA IF NOT EXISTS main;"

# Native PostgreSQL kullanıyorsanız
psql -U postgres -d collmind_tpm -c "CREATE SCHEMA IF NOT EXISTS main;"
```

### Node.js ile İlgili Sorunlar

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

#### Problem: Migration çalışmıyor

**Çözüm:**
1. `.env` dosyasındaki veritabanı bilgilerini kontrol edin
2. PostgreSQL'in çalıştığını doğrulayın
3. Migration dosyalarının derlendiğinden emin olun:
   ```bash
   npm run build:migrations
   ```

### Genel Sorunlar

#### Problem: Port 3000 zaten kullanılıyor

**Çözüm:**

Port'u kullanan process'i bulun:
```bash
lsof -i :3000
```

Process'i sonlandırın:
```bash
kill -9 <PID>
```

Veya `.env` dosyasında farklı bir port kullanın:
```env
PORT=3001
```

---

## Hızlı Başlangıç Özeti

Tüm kurulumu tek seferde yapmak için:

```bash
# 1. Proje dizinine git
cd /Users/tarikkinin/Projects/collmind/collmind.backend

# 2. Bağımlılıkları yükle
npm install

# 3. .env dosyasını oluştur
cp .env.example .env
# .env dosyasını düzenleyin

# 4. PostgreSQL'i Docker ile başlat
docker compose up -d postgres

# 4a. Veritabanı rollerini kur (K-2.6.13 — migration'lardan ÖNCE)
DB_RUNTIME_PASSWORD=<.env'deki DB_RUNTIME_PASSWORD> \
DB_MIGRATE_PASSWORD=<.env'deki DB_MIGRATE_PASSWORD> \
  bash scripts/db-roles-setup.sh

# 5. Migration'ları çalıştır
npm run migration:run

# 5a. app_runtime GRANT setini uygula (K-2.6.13f — migration'lardan SONRA)
npm run db:roles:grants
npm run db:roles:operator-grants   # 4. adım — K1a: app_operator GRANT'leri (Z52 §3)

# 6. (Opsiyonel) Seed verilerini yükle
npm run seed:run

# 7. Projeyi başlat
npm run start:dev
```

---

## Ek Kaynaklar

- [Docker Desktop Dokümantasyonu](https://docs.docker.com/desktop/)
- [PostgreSQL Dokümantasyonu](https://www.postgresql.org/docs/)
- [NestJS Dokümantasyonu](https://docs.nestjs.com/)
- [TypeORM Dokümantasyonu](https://typeorm.io/)

---

## Destek

Sorun yaşarsanız:
1. Bu dokümantasyondaki [Sorun Giderme](#sorun-giderme) bölümüne bakın
2. Proje README.md dosyasını kontrol edin
3. Docker ve PostgreSQL loglarını inceleyin
4. Geliştirme ekibiyle iletişime geçin

---

**Son Güncelleme**: 2024
