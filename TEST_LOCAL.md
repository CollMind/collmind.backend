# Local Test Rehberi

Bu rehber, backend uygulamasını deploy etmeden local'de test etmek için adımları içerir.

## Ön Gereksinimler

- Docker ve Docker Compose yüklü olmalı
- Node.js 20+ (opsiyonel, sadece build için)

## Hızlı Başlangıç

### 1. Docker Compose ile Test (Önerilen)

```bash
# Backend klasörüne git
cd collmind.backend

# Docker Compose ile servisleri başlat
docker-compose -f docker-compose.local.yml up --build

# Logları görmek için
docker-compose -f docker-compose.local.yml logs -f backend

# Servisleri durdurmak için
docker-compose -f docker-compose.local.yml down

# Veritabanını da silmek için (tüm veriler silinir)
docker-compose -f docker-compose.local.yml down -v
```

### 2. Sadece Veritabanını Çalıştırma

Eğer sadece veritabanını test etmek istiyorsanız:

```bash
# Sadece postgres'i başlat
docker-compose up postgres

# Veritabanına bağlan
docker exec -it collmind-tpm-postgres-local psql -U postgres -d collmind_tpm
```

### 3. Backend'i Manuel Build ve Çalıştırma

```bash
# Dependencies yükle
npm install

# Build et
npm run build

# Environment variables ayarla
export NODE_ENV=production
export PORT=3000
export DB_HOST=localhost
export DB_PORT=5432
export DB_DATABASE=collmind_tpm
export DB_USERNAME=postgres
export DB_PASSWORD=postgres
export DB_SCHEMA=main
export JWT_SECRET=local-test-secret-key
export JWT_EXPIRATION=24h

# Uygulamayı çalıştır
npm run start:prod
```

## Test Adımları

### 1. Servislerin Çalıştığını Kontrol Et

```bash
# Backend health check
curl http://localhost:3000/

# Swagger documentation
open http://localhost:3000/api
```

### 2. Migration ve Seed Loglarını Kontrol Et

```bash
# Backend loglarını izle
docker-compose -f docker-compose.local.yml logs -f backend

# Şu logları görmelisiniz:
# - ✅ DataSource initialized
# - ✅ Schema "main" exists
# - ✅ Migrations completed successfully
# - ✅ Table "tenants" exists in schema "main"
# - ✅ Seeds completed successfully
```

### 3. Veritabanını Kontrol Et

```bash
# PostgreSQL container'a bağlan
docker exec -it collmind-tpm-postgres-local psql -U postgres -d collmind_tpm

# Schema'yı kontrol et
\dn

# Tabloları listele
\dt main.*

# Migration tablosunu kontrol et
SELECT * FROM main.migrations ORDER BY timestamp;

# Tenants tablosunu kontrol et
SELECT * FROM main.tenants;
```

### 4. API'yi Test Et

```bash
# Health check
curl http://localhost:3000/

# Swagger UI
open http://localhost:3000/api

# Örnek API çağrısı (JWT token gerekebilir)
curl -X GET http://localhost:3000/api/tenants \
  -H "Content-Type: application/json"
```

## Sorun Giderme

### Migration Tablosu Bulunamıyor

Eğer `relation "public.migrations" does not exist` hatası alıyorsanız:

```bash
# Container'ı yeniden başlat
docker-compose -f docker-compose.local.yml restart backend

# Logları kontrol et
docker-compose -f docker-compose.local.yml logs backend
```

### Tenants Tablosu Bulunamıyor

Eğer `Table "tenants" does not exist` hatası alıyorsanız:

1. Migration tablosunu kontrol et:
```sql
SELECT * FROM main.migrations;
SELECT * FROM public.migrations;
```

2. Eğer migration'lar çalışmış ama tablo yoksa, migration tablosunu temizle:
```sql
DELETE FROM main.migrations;
DELETE FROM public.migrations;
```

3. Backend'i yeniden başlat:
```bash
docker-compose -f docker-compose.local.yml restart backend
```

### Port Zaten Kullanılıyor

Eğer port 3000 veya 5432 zaten kullanılıyorsa:

```bash
# docker-compose.local.yml dosyasında portları değiştir
# Örneğin: '3001:3000' veya '5433:5432'
```

### Veritabanını Sıfırlama

Tüm verileri silip sıfırdan başlamak için:

```bash
# Container'ları ve volume'ları sil
docker-compose -f docker-compose.local.yml down -v

# Yeniden başlat
docker-compose -f docker-compose.local.yml up --build
```

## Debug İpuçları

### Backend Loglarını Detaylı Görmek

```bash
# Tüm logları göster
docker-compose -f docker-compose.local.yml logs backend

# Son 100 satır
docker-compose -f docker-compose.local.yml logs --tail=100 backend

# Canlı log takibi
docker-compose -f docker-compose.local.yml logs -f backend
```

### Container'a Bağlanmak

```bash
# Backend container'a bağlan
docker exec -it collmind-tpm-backend-local sh

# Container içinde dosyaları kontrol et
ls -la dist/
cat dist/main.js | head -20
```

### Veritabanı Bağlantısını Test Et

```bash
# PostgreSQL'e bağlan
docker exec -it collmind-tpm-postgres-local psql -U postgres -d collmind_tpm

# Schema'yı kontrol et
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'main';

# Tabloları listele
SELECT table_name FROM information_schema.tables WHERE table_schema = 'main';
```

## Notlar

- Local test için `docker-compose.local.yml` kullanın
- Production için `docker-compose.yml` kullanın
- Veritabanı verileri `postgres_data_local` volume'unda saklanır
- Container'ları silmek verileri silmez, volume'ları silmek gerekir
