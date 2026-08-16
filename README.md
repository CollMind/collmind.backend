# CollMind TPM Backend

NestJS 10.x ile geliştirilmiş TypeScript backend projesi. Trade Promotion Management (TPM) sistemi için RESTful API sağlar.

## 📋 İçindekiler

- [Teknoloji Stack](#teknoloji-stack)
- [Özellikler](#özellikler)
- [Kurulum](#kurulum)
- [Yapılandırma](#yapılandırma)
- [Çalıştırma](#çalıştırma)
- [Veritabanı](#veritabanı)
- [API Dokümantasyonu](#api-dokümantasyonu)
- [Proje Yapısı](#proje-yapısı)
- [Scripts](#scripts)
- [Migration ve Seed](#migration-ve-seed)
- [Test](#test)
- [Docker](#docker)
- [Deployment](#deployment)

## 🛠 Teknoloji Stack

- **Runtime**: Node.js 20.x LTS
- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.3+
- **Database**: PostgreSQL 16.x
- **ORM**: TypeORM 0.3.17
- **Authentication**: Passport JWT
- **API Documentation**: Swagger/OpenAPI
- **Validation**: class-validator, class-transformer
- **File Processing**: xlsx, csv-parser

## ✨ Özellikler

### Core Modüller
- **Authentication & Authorization**: JWT tabanlı kimlik doğrulama ve rol bazlı yetkilendirme
- **Multi-Tenancy**: Çoklu tenant desteği
- **User Management**: Kullanıcı yönetimi ve profil işlemleri
- **Customer Management**: Müşteri yönetimi ve toplu içe aktarma

### Master Data Yönetimi
- Brand (Marka)
- Category (Kategori)
- Channel (Kanal)
- CPL (Customer Product Line)
- Forecasting Unit (FU)
- Generic Unit (GU)
- KPI (Key Performance Indicator)
- Mechanic (Mekanik)
- Region (Bölge)
- SKU (Stock Keeping Unit)
- Tactic (Taktik)

### İş Modları

#### Actuals-First Mode
- **Agreement Management**: Anlaşma yönetimi ve işlemleri
- **Agreement Transactions**: Anlaşma işlem takibi
- **Ledger**: Defter tutma ve kayıt yönetimi
- **On-Invoice**: Fatura üzeri işlemler

#### Planning-First Mode
- **Plan Management**: Plan oluşturma, düzenleme ve yönetimi
- **Plan Approval Workflow**: Çok seviyeli onay süreçleri
- **Plan Performance Tracking**: Plan performans takibi

### Paylaşılan Modüller
- **Budget Management**: Bütçe zarfı yönetimi ve event-sourced bütçe işlemleri
- **Approval System**: Çok seviyeli onay sistemi ve politika tabanlı yönlendirme
- **KPI Engine**: KPI hesaplama motoru
- **LTA (Long Term Agreement)**: Uzun vadeli anlaşma yönetimi
- **Spend Calculation**: Harcama hesaplama modülü
- **Finance Reporting**: Finansal raporlama
- **Notification System**: Bildirim sistemi

### Admin Özellikleri
- Audit log yönetimi
- Sistem yapılandırması
- Baseline import

## 🚀 Kurulum

### Gereksinimler

- Node.js 20.x LTS
- npm veya yarn
- PostgreSQL 16.x (veya Docker)
- Docker ve Docker Compose (önerilen)

### Adımlar

1. **Bağımlılıkları yükleyin:**
```bash
npm install
```

2. **`.env` dosyasını oluşturun:**
```bash
cp .env.example .env
```

3. **`.env` dosyasını düzenleyin:**
```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=collmind_tpm
DB_SCHEMA=main

# K-2.6.13: iki AYRI, AYRICALIKSIZ bağlantı rolü — tek 'postgres' kimliği
# YOK. Değerleri kendiniz belirleyin (herhangi bir yerel parola), sonra
# `bash scripts/db-roles-setup.sh` ile rolleri DB'de yaratın (adım 4a).
DB_RUNTIME_USERNAME=app_runtime
DB_RUNTIME_PASSWORD=<yerel-parola-seçin>
DB_MIGRATE_USERNAME=app_migrate
DB_MIGRATE_PASSWORD=<yerel-parola-seçin>

# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=1d
```

4. **PostgreSQL'i Docker ile başlatın:**
```bash
docker-compose up -d
```

4a. **Veritabanı rollerini kurun (K-2.6.13 — idempotent, tekrar çalıştırılabilir):**
```bash
DB_RUNTIME_PASSWORD=<.env'deki DB_RUNTIME_PASSWORD> \
DB_MIGRATE_PASSWORD=<.env'deki DB_MIGRATE_PASSWORD> \
  bash scripts/db-roles-setup.sh
```
Bu betik `app_runtime` (uygulamanın çalışma zamanı rolü — DML, RLS'e tabi,
DDL yok) ve `app_migrate` (migration/seed rolü — DDL yetkili, tablo sahibi)
rollerini yaratır. Uygulama artık ayrıcalıklı `postgres` rolüyle
BAĞLANMAZ — bu adım atlanırsa `npm run start:dev` / `migration:run` /
`seed` bağlantı hatasıyla durur (K-2.6.13d: sessiz geri dönüş yok).

5. **Migration'ları çalıştırın (`app_migrate` ile):**
```bash
npm run migration:run
```

6. **Seed verilerini yükleyin (opsiyonel, `app_migrate` ile):**
```bash
npm run seed:run
```

## ⚙️ Yapılandırma

### Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `NODE_ENV` | Çalışma ortamı (development/production) | `development` |
| `PORT` | API port numarası | `3000` |
| `DB_HOST` | PostgreSQL host adresi | `localhost` |
| `DB_PORT` | PostgreSQL port numarası | `5432` |
| `DB_RUNTIME_USERNAME` | Uygulamanın çalışma zamanı rolü (K-2.6.13a) — DML, RLS'e tabi, DDL yok | `app_runtime` |
| `DB_RUNTIME_PASSWORD` | `app_runtime` parolası — zorunlu, varsayılanı yok | - |
| `DB_MIGRATE_USERNAME` | Migration/seed rolü (K-2.6.13a) — DDL yetkili, tablo sahibi | `app_migrate` |
| `DB_MIGRATE_PASSWORD` | `app_migrate` parolası — zorunlu, varsayılanı yok | - |
| `DB_DATABASE` | Veritabanı adı | `collmind_tpm` |
| `DB_SCHEMA` | PostgreSQL şema adı | `main` |
| `JWT_SECRET` | JWT imza anahtarı | - |
| `JWT_EXPIRES_IN` | JWT token geçerlilik süresi | `1d` |

⚠️ **`DB_USERNAME`/`DB_PASSWORD` artık kullanılmıyor** (K-2.6.13 — ayrıcalıksız
rol ayrımı). Eski `.env` dosyanızda bu iki değişken varsa kalabilir ama hiçbir
kod yolu onları okumaz; yukarıdaki dört `DB_RUNTIME_*`/`DB_MIGRATE_*`
değişkeni olmadan uygulama ve CLI komutları AÇIK HATA ile durur.

## 🏃 Çalıştırma

### Development
```bash
npm run start:dev
```

### Production
```bash
npm run build
npm run start:prod
```

### Debug Mode
```bash
npm run start:debug
```

Uygulama çalıştıktan sonra şu adresten erişilebilir:
- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`

## 🗄️ Veritabanı

### PostgreSQL Yapılandırması

- **Veritabanı**: `collmind_tpm`
- **Şema**: `main` (PostgreSQL schema)
- **Port**: `5432` (varsayılan)

### Docker ile Çalıştırma

```bash
# PostgreSQL container'ını başlat
docker-compose up -d postgres

# Container durumunu kontrol et
docker-compose ps

# Logları görüntüle
docker-compose logs -f postgres
```

### Şema Oluşturma

Şema otomatik olarak Docker container başlatıldığında `docker/init-schema.sql` dosyası ile oluşturulur.

**Not**: Development modunda TypeORM `synchronize: true` olarak ayarlanmıştır. Production ortamında mutlaka `false` yapılmalı ve migration'lar kullanılmalıdır.

## 📚 API Dokümantasyonu

Uygulama çalıştıktan sonra Swagger dokümantasyonuna şu adresten erişebilirsiniz:

- **Swagger UI**: `http://localhost:3000/api`
- **JSON Schema**: `http://localhost:3000/api-json`

Swagger dokümantasyonu tüm endpoint'leri, request/response şemalarını ve authentication gereksinimlerini içerir.

## 📁 Proje Yapısı

```
src/
├── modules/              # Domain modülleri
│   ├── admin/           # Admin işlemleri
│   ├── customer/        # Müşteri yönetimi
│   ├── master-data/     # Master data modülleri
│   │   ├── brand/
│   │   ├── category/
│   │   ├── channel/
│   │   ├── cpl/
│   │   ├── forecasting-unit/
│   │   ├── generic-unit/
│   │   ├── kpi/
│   │   ├── mechanic/
│   │   ├── region/
│   │   ├── sku/
│   │   └── tactic/
│   ├── modes/           # İş modları
│   │   ├── actuals-first/    # Actuals-First mode
│   │   │   ├── agreement/
│   │   │   ├── agreement-transaction/
│   │   │   ├── ledger/
│   │   │   └── on-invoice/
│   │   └── planning-first/   # Planning-First mode
│   │       └── plan/
│   ├── notification/    # Bildirim sistemi
│   ├── shared/          # Paylaşılan modüller
│   │   ├── approval/    # Onay sistemi
│   │   ├── budget/      # Bütçe yönetimi
│   │   ├── finance-reporting/
│   │   ├── kpi-engine/  # KPI hesaplama motoru
│   │   ├── lta/         # Long Term Agreement
│   │   ├── reporting/   # Raporlama
│   │   └── spend-calculation/
│   ├── tenant/          # Tenant yönetimi
│   └── user/            # Kullanıcı yönetimi ve auth
├── common/              # Paylaşılan utilities
│   ├── guards/          # Route guards
│   ├── filters/         # Exception filters
│   ├── decorators/      # Custom decorators
│   ├── interceptors/    # Interceptors
│   ├── pipes/           # Validation pipes
│   └── interfaces/      # TypeScript interfaces
├── config/              # Yapılandırma modülleri
│   ├── config.module.ts
│   └── typeorm.config.ts
├── database/            # TypeORM setup ve entities
│   ├── entities/        # Veritabanı entity'leri
│   ├── migrations/      # Migration dosyaları
│   └── seeds/           # Seed dosyaları
├── app.module.ts        # Root module
├── app.controller.ts    # Root controller
├── app.service.ts       # Root service
└── main.ts              # Application entry point
```

## 📜 Scripts

### Build Scripts
- `npm run build` - Projeyi derle
- `npm run build:migrations` - Migration dosyalarını derle
- `npm run build:runtime` - Runtime dosyalarını derle

### Development Scripts
- `npm run start` - Production modunda başlat
- `npm run start:dev` - Development modunda başlat (watch mode)
- `npm run start:debug` - Debug modunda başlat

### Code Quality
- `npm run lint` - ESLint ile kod kontrolü
- `npm run format` - Prettier ile kod formatla

### Database Scripts
- `npm run migration:generate` - Yeni migration oluştur
- `npm run migration:create` - Boş migration dosyası oluştur
- `npm run migration:run` - Migration'ları çalıştır
- `npm run migration:revert` - Son migration'ı geri al
- `npm run migration:run:prod` - Production migration'ları çalıştır

### Seed Scripts
- `npm run seed:run` - Seed verilerini yükle
- `npm run seed:cleanup` - Seed verilerini temizle
- `npm run seed:cleanup-and-seed` - Temizle ve yeniden yükle
- `npm run test:happy-path` - Happy path test verilerini yükle
- `npm run seed:prod` - Production seed'leri çalıştır
- `npm run db:init:prod` - Production veritabanını başlat (migration + seed)

### Test Scripts
- `npm run test` - Unit testleri çalıştır
- `npm run test:watch` - Testleri watch mode'da çalıştır
- `npm run test:cov` - Test coverage raporu oluştur
- `npm run test:debug` - Debug mode'da test çalıştır
- `npm run test:e2e` - E2E testleri çalıştır

## 🔄 Migration ve Seed

### Migration Oluşturma

```bash
# Otomatik migration oluştur (değişiklikleri algılar)
npm run migration:generate -- src/database/migrations/MigrationName

# Manuel migration oluştur
npm run migration:create -- src/database/migrations/MigrationName
```

### Migration Çalıştırma

```bash
# Development
npm run migration:run

# Production
npm run migration:run:prod
```

### Seed Verileri

```bash
# Seed verilerini yükle
npm run seed:run

# Seed verilerini temizle
npm run seed:cleanup

# Temizle ve yeniden yükle
npm run seed:cleanup-and-seed
```

## 🧪 Test

### Unit Testler
```bash
npm run test
```

### E2E Testler
```bash
npm run test:e2e
```

### Test Coverage
```bash
npm run test:cov
```

## 🐳 Docker

### Docker Compose ile Çalıştırma

```bash
# Tüm servisleri başlat (PostgreSQL + Backend)
docker-compose up -d

# Sadece PostgreSQL'i başlat
docker-compose up -d postgres

# Logları görüntüle
docker-compose logs -f

# Servisleri durdur
docker-compose down

# Verileri de silerek durdur
docker-compose down -v
```

### Dockerfile ile Build

```bash
# Image oluştur
docker build -t collmind-tpm-backend .

# Container çalıştır
docker run -p 3000:3000 --env-file .env collmind-tpm-backend
```

## 🚢 Deployment

### Production Build

```bash
# Projeyi derle
npm run build

# Production modunda çalıştır
npm run start:prod
```

### Cloud Run Deployment

Proje Bitbucket Pipelines ile Cloud Run'a deploy edilir. `bitbucket-pipelines.yml` dosyası deployment sürecini yönetir.

### Production Checklist

- [ ] `.env` dosyasında production değerleri ayarlanmalı
- [ ] `JWT_SECRET` güçlü bir değer olmalı
- [ ] TypeORM `synchronize: false` olmalı
- [ ] Migration'lar çalıştırılmalı
- [ ] Seed verileri yüklenmeli (gerekirse)
- [ ] CORS ayarları production için yapılandırılmalı
- [ ] Rate limiting aktif olmalı
- [ ] Logging yapılandırılmalı

## 📝 Notlar

- Development modunda TypeORM `synchronize: true` kullanılır. Production'da mutlaka migration'lar kullanılmalıdır.
- JWT secret production'da mutlaka değiştirilmelidir.
- PostgreSQL şeması `main` olarak adlandırılmıştır ve otomatik oluşturulur.
- Swagger dokümantasyonu sadece development modunda aktif olabilir (production'da kapatılabilir).

## 📄 Lisans

Copyright © 2024 CollMind. All rights reserved.

---

## 🤖 AI-Assisted Development — SAFE PROMPT

Bu projede tüm kod değişiklikleri **SAFE PROMPT** metodolojisiyle yönetilir.

Standart ve sprint prompt dosyaları:
- `docs/safe-prompt-standard-v2.md` — Tam standart tanımı
- `docs/safe-prompts/` — Sprint bazında implementation prompt'ları
- `.bitbucket/pull-request-template.md` — PR checklist şablonu

**Kritik kurallar:**
- `staging` branch'ine direkt push yok — her zaman PR
- Migration dosyaları Windsurf tarafından oluşturulur, geliştirici tarafından çalıştırılır
- İki repo kapsayan feature'larda backend PR her zaman önce merge edilir