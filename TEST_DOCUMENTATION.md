# CollMind TPM Backend - Unit Test Dokümantasyonu

## Buraya değişiklik yaptım

Bu dokümantasyon, CollMind TPM Backend projesi için unit test yapısını, test stratejilerini ve test yazma standartlarını açıklar.

## 📋 İçindekiler

- [Genel Bakış](#genel-bakış)
- [Test Yapısı](#test-yapısı)
- [Test Çalıştırma](#test-çalıştırma)
- [Test Kapsamı](#test-kapsamı)
- [Test Yazma Standartları](#test-yazma-standartları)
- [Mock ve Stub Kullanımı](#mock-ve-stub-kullanımı)
- [Test Örnekleri](#test-örnekleri)
- [Best Practices](#best-practices)
- [Coverage Hedefleri](#coverage-hedefleri)

## 🎯 Genel Bakış

CollMind TPM Backend projesi, NestJS framework'ü kullanılarak geliştirilmiştir ve Jest test framework'ü ile unit testler yazılmaktadır. Testler, servislerin, controller'ların ve repository'lerin doğru çalıştığını doğrulamak için yazılmıştır.

### Test Framework

- **Jest**: Test framework ve assertion library
- **@nestjs/testing**: NestJS test utilities
- **ts-jest**: TypeScript için Jest transformer

## 📁 Test Yapısı

Test dosyaları, kaynak dosyalarının yanında `.spec.ts` uzantısı ile yer alır:

```
src/
├── modules/
│   ├── user/
│   │   ├── user.service.ts
│   │   └── user.service.spec.ts
│   ├── customer/
│   │   ├── customer.service.ts
│   │   └── customer.service.spec.ts
│   └── ...
├── app.service.ts
└── app.service.spec.ts
```

### Test Dosya Adlandırma

- Servis testleri: `{service-name}.service.spec.ts`
- Controller testleri: `{controller-name}.controller.spec.ts`
- Repository testleri: `{repository-name}.repository.spec.ts`
- Entity testleri: `{entity-name}.entity.spec.ts`

## 🚀 Test Çalıştırma

### Tüm Testleri Çalıştırma

```bash
npm run test
```

### Watch Mode (Geliştirme Sırasında)

```bash
npm run test:watch
```

### Coverage Raporu

```bash
npm run test:cov
```

Coverage raporu `coverage/` klasöründe oluşturulur.

### Belirli Bir Test Dosyasını Çalıştırma

```bash
npm run test -- user.service.spec.ts
```

### Debug Mode

```bash
npm run test:debug
```

## 📊 Test Kapsamı

### Mevcut Test Dosyaları

#### ✅ Tamamlanmış Testler

1. **App Service** (`app.service.spec.ts`)
   - `getHello()` metodu testleri

2. **User Service** (`user.service.spec.ts`)
   - Kullanıcı oluşturma
   - Giriş yapma ve token üretme
   - Kullanıcı listeleme ve bulma
   - Kullanıcı güncelleme
   - Şifre değiştirme
   - Kullanıcı aktivasyon/deaktivasyon
   - Token yenileme
   - Çıkış yapma
   - Dashboard özeti

3. **Customer Service** (`customer.service.spec.ts`)
   - Müşteri oluşturma
   - Toplu müşteri oluşturma
   - Müşteri listeleme ve filtreleme
   - Müşteri bulma
   - Müşteri güncelleme
   - Müşteri silme
   - Müşteri aktivasyon/deaktivasyon
   - Dosyadan müşteri içe aktarma (Excel/CSV)
   - Dosya validasyonu
   - CPL listesi

4. **Tenant Service** (`tenant.service.spec.ts`)
   - Tenant oluşturma
   - Tenant listeleme
   - Tenant bulma
   - Tenant güncelleme
   - Tenant silme
   - Tenant aktivasyon/askıya alma
   - Tenant istatistikleri

5. **Brand Service** (`brand.service.spec.ts`)
   - Marka oluşturma
   - Marka listeleme
   - Marka bulma
   - Marka güncelleme
   - Marka silme

#### 🔄 Mevcut Testler (Güncellenebilir)

- `plan.service.spec.ts` - Plan servisi testleri
- `budget-allocation.service.spec.ts` - Bütçe tahsisi testleri
- `spend-calculation.service.spec.ts` - Harcama hesaplama testleri
- `approval-workflow.service.spec.ts` - Onay iş akışı testleri

### Eksik Testler

Aşağıdaki servisler için test dosyaları oluşturulmalıdır:

#### Master Data Servisleri

- [ ] `category.service.spec.ts`
- [ ] `channel.service.spec.ts`
- [ ] `cpl.service.spec.ts`
- [ ] `forecasting-unit.service.spec.ts` (fu.service.spec.ts)
- [ ] `generic-unit.service.spec.ts` (gu.service.spec.ts)
- [ ] `kpi.service.spec.ts`
- [ ] `mechanic.service.spec.ts`
- [ ] `region.service.spec.ts`
- [ ] `sku.service.spec.ts`
- [ ] `tactic.service.spec.ts`

#### İş Modu Servisleri

- [ ] `agreement.service.spec.ts`
- [ ] `agreement-transaction.service.spec.ts`
- [ ] `ledger.service.spec.ts`
- [ ] `on-invoice.service.spec.ts`

#### Paylaşılan Servisler

- [ ] `budget.service.spec.ts`
- [ ] `approval.service.spec.ts`
- [ ] `kpi-engine.service.spec.ts`
- [ ] `formula-parser.service.spec.ts`
- [ ] `lta-agreement.service.spec.ts`
- [ ] `lta-calculation.service.spec.ts`
- [ ] `finance-reporting.service.spec.ts`
- [ ] `spend-validation.service.spec.ts`
- [ ] `spend-distribution.service.spec.ts`
- [ ] `notification.service.spec.ts`

#### Controller Testleri

- [ ] `user.controller.spec.ts`
- [ ] `customer.controller.spec.ts`
- [ ] `tenant.controller.spec.ts`
- [ ] `auth.controller.spec.ts`
- [ ] Tüm master data controller'ları
- [ ] Tüm iş modu controller'ları

## ✍️ Test Yazma Standartları

### Test Yapısı

Her test dosyası aşağıdaki yapıyı takip etmelidir:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceName } from './service-name';
import { DependencyService } from './dependency.service';

describe('ServiceName', () => {
  let service: ServiceName;
  let dependencyService: jest.Mocked<DependencyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceName,
        {
          provide: DependencyService,
          useValue: {
            // Mock methods
          },
        },
      ],
    }).compile();

    service = module.get<ServiceName>(ServiceName);
    dependencyService = module.get(DependencyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should do something successfully', async () => {
      // Arrange
      // Act
      // Assert
    });

    it('should throw error when condition', async () => {
      // Arrange
      // Act & Assert
    });
  });
});
```

### Test İsimlendirme

- **Describe blokları**: Test edilen sınıf veya metod adını kullanın
- **It blokları**: "should" ile başlayın ve ne yapması gerektiğini açıklayın
- **Test isimleri**: Açıklayıcı ve spesifik olmalı

**İyi örnekler:**
```typescript
it('should create a new user successfully', async () => {});
it('should throw ConflictException if user with email already exists', async () => {});
it('should return all users for tenant', async () => {});
```

**Kötü örnekler:**
```typescript
it('test create', async () => {});
it('works', async () => {});
it('should work', async () => {});
```

### AAA Pattern (Arrange-Act-Assert)

Her test üç bölümden oluşmalıdır:

```typescript
it('should create a new user successfully', async () => {
  // Arrange: Test verilerini hazırla
  const createUserDto: CreateUserDto = {
    email: 'test@example.com',
    password: 'password123',
    fullName: 'Test User',
    role: UserRole.PLANNER,
  };
  userRepository.findByEmail.mockResolvedValue(null);
  userRepository.create.mockReturnValue(mockUser);
  userRepository.save.mockResolvedValue(mockUser);

  // Act: Test edilen metodu çağır
  const result = await service.create(mockTenantId, createUserDto);

  // Assert: Sonuçları doğrula
  expect(userRepository.findByEmail).toHaveBeenCalledWith(
    mockTenantId,
    createUserDto.email,
  );
  expect(result).toEqual(mockUser);
});
```

## 🎭 Mock ve Stub Kullanımı

### Repository Mocking

```typescript
{
  provide: UserRepository,
  useValue: {
    create: jest.fn(),
    save: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    findAllByTenant: jest.fn(),
    softRemove: jest.fn(),
  },
}
```

### Service Mocking

```typescript
{
  provide: JwtService,
  useValue: {
    sign: jest.fn(),
    verify: jest.fn(),
  },
}
```

### TypeORM Repository Mocking

```typescript
{
  provide: getRepositoryToken(Plan),
  useValue: {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  },
}
```

### Mock Return Values

```typescript
// Başarılı senaryo
repository.findById.mockResolvedValue(mockEntity);

// Hata senaryosu
repository.findById.mockResolvedValue(null);

// Hata fırlatma
repository.save.mockRejectedValue(new Error('Database error'));
```

## 📝 Test Örnekleri

### Basit CRUD Testi

```typescript
describe('create', () => {
  it('should create a new entity successfully', async () => {
    repository.findByCode.mockResolvedValue(null);
    repository.create.mockReturnValue(mockEntity);
    repository.save.mockResolvedValue(mockEntity);

    const result = await service.create(tenantId, createDto);

    expect(repository.findByCode).toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalled();
    expect(result).toEqual(mockEntity);
  });

  it('should throw ConflictException if entity already exists', async () => {
    repository.findByCode.mockResolvedValue(mockEntity);

    await expect(service.create(tenantId, createDto)).rejects.toThrow(
      ConflictException,
    );
  });
});
```

### Exception Testi

```typescript
describe('findOne', () => {
  it('should throw NotFoundException if entity not found', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne(tenantId, entityId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

### Validation Testi

```typescript
describe('importFromFile', () => {
  it('should validate customer data and return errors for invalid rows', async () => {
    const invalidCustomers = [
      { dto: { code: '', name: 'Customer 1' }, originalRowNumber: 2 },
    ];

    fileParserService.parseExcel.mockResolvedValue(invalidCustomers);

    const result = await service.importFromFile(tenantId, mockFile);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.error_type === 'MISSING_FIELD')).toBe(true);
  });
});
```

### Complex Business Logic Testi

```typescript
describe('getDashboardSummary', () => {
  it('should return dashboard summary with correct calculations', async () => {
    const plans = [{ id: '1', status: PlanStatus.APPROVED }];
    const agreements = [{ id: '1', status: AgreementStatus.ACTIVE }];
    const envelopes = [
      { allocatedAmount: 1000, consumedAmount: 500, period: 'Q1' },
    ];

    planRepository.find.mockResolvedValue(plans);
    agreementRepository.find.mockResolvedValue(agreements);
    budgetEnvelopeRepository.find.mockResolvedValue(envelopes);

    const result = await service.getDashboardSummary(tenantId);

    expect(result.activeOperations).toBe(2);
    expect(result.budgetUsage).toBe(50);
  });
});
```

## 🎯 Best Practices

### 1. Test İzolasyonu

- Her test bağımsız olmalı
- `beforeEach` ve `afterEach` kullanarak test verilerini temizleyin
- `jest.clearAllMocks()` ile mock'ları temizleyin

### 2. Test Verileri

- Mock verileri `beforeEach` içinde tanımlayın
- Gerçekçi test verileri kullanın
- Test verilerini yeniden kullanılabilir hale getirin

### 3. Assertion'lar

- Her test en az bir assertion içermeli
- Spesifik assertion'lar kullanın
- `toHaveBeenCalledWith` ile metod çağrılarını doğrulayın

### 4. Test Kapsamı

- Her public metod için test yazın
- Edge case'leri test edin
- Error handling'i test edin
- Validation'ları test edin

### 5. Test Organizasyonu

- İlgili testleri `describe` blokları içinde gruplayın
- Testleri mantıksal sıraya göre düzenleyin
- Her metod için ayrı `describe` bloğu kullanın

### 6. Mock Kullanımı

- Sadece gerekli dependency'leri mock'layın
- Mock'ları gerçekçi yapın
- Mock return value'ları açıklayıcı isimlerle tanımlayın

### 7. Async Testler

- `async/await` kullanın
- Promise rejection'ları test edin
- Timeout'ları ayarlayın (gerekirse)

## 📈 Coverage Hedefleri

### Minimum Coverage

- **Statements**: %80
- **Branches**: %75
- **Functions**: %80
- **Lines**: %80

### İdeal Coverage

- **Statements**: %90+
- **Branches**: %85+
- **Functions**: %90+
- **Lines**: %90+

### Coverage Raporu Görüntüleme

```bash
npm run test:cov
```

Rapor `coverage/lcov-report/index.html` dosyasında görüntülenebilir.

## 🔍 Test Debugging

### Jest Debug Mode

```bash
npm run test:debug
```

### Console Log Kullanımı

```typescript
it('should debug test', async () => {
  console.log('Mock value:', mockValue);
  console.log('Result:', result);
});
```

### Test Filtreleme

```bash
# Sadece belirli test dosyasını çalıştır
npm run test -- user.service.spec.ts

# Sadece belirli test'i çalıştır
npm run test -- -t "should create a new user"
```

## 📚 Ek Kaynaklar

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

## 🐛 Yaygın Sorunlar ve Çözümleri

### Mock'lar Çalışmıyor

**Sorun**: Mock'lar beklenen değerleri döndürmüyor.

**Çözüm**: `beforeEach` içinde mock'ları doğru şekilde tanımladığınızdan emin olun.

### Async Test Hataları

**Sorun**: Test async işlemleri beklemeden bitiyor.

**Çözüm**: `async/await` kullanın veya `done` callback'i kullanın.

### TypeORM Repository Mocking

**Sorun**: TypeORM repository'leri mock'lanamıyor.

**Çözüm**: `getRepositoryToken` kullanın:

```typescript
{
  provide: getRepositoryToken(Entity),
  useValue: {
    find: jest.fn(),
    findOne: jest.fn(),
  },
}
```

## 📝 Test Checklist

Yeni bir test dosyası yazarken:

- [ ] Test dosyası doğru konumda mı? (`*.spec.ts`)
- [ ] Tüm public metodlar test edildi mi?
- [ ] Edge case'ler test edildi mi?
- [ ] Error handling test edildi mi?
- [ ] Mock'lar doğru tanımlandı mı?
- [ ] Test isimleri açıklayıcı mı?
- [ ] AAA pattern kullanıldı mı?
- [ ] `afterEach` ile mock'lar temizlendi mi?
- [ ] Coverage hedefleri karşılandı mı?

## 🎓 Öğrenme Kaynakları

1. Mevcut test dosyalarını inceleyin
2. Jest dokümantasyonunu okuyun
3. NestJS testing guide'ını takip edin
4. Code review sırasında testleri de gözden geçirin

---

**Son Güncelleme**: 2024
**Versiyon**: 1.0.0
