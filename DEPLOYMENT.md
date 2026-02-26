# Deployment Guide

## Production Database Initialization

Production ortamında veritabanı migration ve seed işlemlerini çalıştırmak için aşağıdaki adımları izleyin.

### Önemli Notlar

⚠️ **Cloud Run Scale Risk**: Migration ve seed işlemleri **uygulama servisi başlatılırken otomatik çalıştırılmamalıdır**. Cloud Run otomatik scaling yaptığında birden fazla instance aynı anda migration/seed çalıştırabilir, bu da veritabanı çakışmalarına neden olabilir.

✅ **Önerilen Yaklaşım**: Migration ve seed işlemlerini **tek seferlik** bir komut olarak çalıştırın. Cloud Run'da bunun için **Cloud Run Job** kullanılması önerilir.

### Komutlar

#### 1. Sadece Migration Çalıştırma

```bash
npm run migration:run:prod
```

Bu komut `dist/config/typeorm.config.js` dosyasını kullanarak migration'ları çalıştırır.

#### 2. Sadece Seed Çalıştırma

```bash
npm run seed:prod
```

Bu komut `dist/database/seeds/run-seeds.js` dosyasını Node.js ile çalıştırır.

#### 3. Migration + Seed (Önerilen)

```bash
npm run db:init:prod
```

Bu komut önce migration'ları çalıştırır, sonra seed'leri çalıştırır.

### Cloud Run Deployment

#### Container Build

Docker image build edildiğinde:
- Migration dosyaları `dist/database/migrations/*.js` olarak derlenir
- Seed dosyası `dist/database/seeds/run-seeds.js` olarak derlenir
- Build sırasında bu dosyaların varlığı kontrol edilir

#### Cloud Run Service

Uygulama servisi (`entrypoint.sh`) sadece API'yi başlatır:
```bash
node dist/main
```

Migration ve seed işlemleri **servis başlatılırken çalıştırılmaz**.

#### Cloud Run Job (Önerilen)

Veritabanı initialization için ayrı bir Cloud Run Job oluşturun:

```yaml
# cloud-run-job.yaml örneği
apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: db-init
spec:
  template:
    spec:
      containers:
      - image: gcr.io/PROJECT_ID/IMAGE_NAME:TAG
        command: ["npm", "run", "db:init:prod"]
        env:
        - name: NODE_ENV
          value: "production"
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-host
              key: value
        # ... diğer environment variables
```

Job'u çalıştırmak için:
```bash
gcloud run jobs execute db-init --region=REGION
```

### Local Development

Local development için:

```bash
# Migration çalıştırma
npm run migration:run

# Seed çalıştırma
npm run seed

# Her ikisini birden
npm run migration:run && npm run seed
```

### Seed Dosyaları

Seed dosyaları **idempotent** olarak tasarlanmıştır:
- Var olan kayıtlar kontrol edilir
- Duplicate insert hatası alınmaz
- Seed'ler tekrar çalıştırılabilir

### Troubleshooting

#### Migration/Seed çalışmıyor

1. `dist/config/typeorm.config.js` dosyasının varlığını kontrol edin
2. `dist/database/migrations/*.js` dosyalarının varlığını kontrol edin
3. `dist/database/seeds/run-seeds.js` dosyasının varlığını kontrol edin
4. Environment variables'ların doğru ayarlandığını kontrol edin

#### TypeScript syntax hatası

Eğer derlenmiş dosyalarda TypeScript syntax (`implements MigrationInterface` gibi) görüyorsanız:
- Build sürecini kontrol edin: `npm run build`
- `tsconfig.migrations.json` dosyasının doğru yapılandırıldığını kontrol edin

#### Path alias hatası

Production'da `@/` path alias'ları çalışmaz. Seed dosyalarında relative path kullanılmalıdır.
Mevcut seed dosyaları zaten relative path kullanmaktadır.
