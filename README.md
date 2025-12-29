# CollMind TPM Backend

NestJS 10.x ile geliştirilmiş TypeScript backend projesi.

## Teknoloji Stack

- Node.js 20.x LTS
- NestJS 10.x
- TypeScript 5.3+
- PostgreSQL 16.x
- TypeORM
- Passport JWT
- Swagger/OpenAPI

## Kurulum

1. Bağımlılıkları yükleyin:
```bash
npm install
```

2. `.env` dosyasını oluşturun:
```bash
# .env dosyası oluşturun ve aşağıdaki içeriği ekleyin:
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=collmind_tpm
DB_SCHEMA=main

# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=1d
```

3. PostgreSQL'i Docker ile başlatın:
```bash
docker-compose up -d
```

4. Uygulamayı çalıştırın:
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Dokümantasyonu

Uygulama çalıştıktan sonra Swagger dokümantasyonuna şu adresten erişebilirsiniz:
- http://localhost:3000/api

## Proje Yapısı

```
src/
├── modules/          # Domain modülleri
├── common/           # Shared utilities, guards, filters, decorators
│   ├── guards/
│   ├── filters/
│   ├── decorators/
│   ├── interceptors/
│   ├── pipes/
│   └── interfaces/
├── config/           # Configuration modules
├── database/         # TypeORM setup
├── app.module.ts     # Root module
├── app.controller.ts # Root controller
├── app.service.ts    # Root service
└── main.ts           # Application entry point
```

## Scripts

- `npm run build` - Projeyi derle
- `npm run start` - Production modunda başlat
- `npm run start:dev` - Development modunda başlat (watch mode)
- `npm run start:debug` - Debug modunda başlat
- `npm run lint` - ESLint ile kod kontrolü
- `npm run format` - Prettier ile kod formatla
- `npm run test` - Unit testleri çalıştır
- `npm run test:e2e` - E2E testleri çalıştır

## Veritabanı

PostgreSQL 16.x Docker container olarak çalışır. Bağlantı bilgileri `.env` dosyasında tanımlıdır.

- Veritabanı şeması: `main` (PostgreSQL schema)
- Şema otomatik olarak Docker container başlatıldığında oluşturulur
- Development modunda TypeORM `synchronize: true` olarak ayarlanmıştır (production'da false olmalıdır)

