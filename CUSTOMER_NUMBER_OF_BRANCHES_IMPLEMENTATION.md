# Customer - Şube Sayısı (numberOfBranches) Alanı Ekleme Dökümanı

## Genel Bakış

Bu döküman, React.js frontend projesine müşteri (Customer) bilgilerine **şube sayısı (numberOfBranches)** alanını eklemek için gerekli tüm adımları içermektedir.

**Backend Durumu**: ✅ Backend'de alan eklendi ve tüm endpointlerde kullanılabilir durumda.

---

## 1. TypeScript Types Güncellemesi

### 1.1 Customer Interface Güncellemesi

**Dosya**: `src/types/customer.types.ts`

`Customer` interface'ine `numberOfBranches` alanını ekleyin:

```typescript
export interface Customer {
  id: string;
  code: string;
  name: string;
  channel: CustomerChannel;
  type: CustomerType;
  status: CustomerStatus;
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  customerTier?: string;
  numberOfBranches?: number;  // ✅ YENİ ALAN
  isVip: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 1.2 CreateCustomerDto Güncellemesi

**Dosya**: `src/types/customer.types.ts`

`CreateCustomerDto` interface'ine `numberOfBranches` alanını ekleyin:

```typescript
export interface CreateCustomerDto {
  code: string;
  name: string;
  channel: CustomerChannel;
  type?: CustomerType;
  status?: CustomerStatus;
  // ... diğer alanlar ...
  firstOrderDate?: string;
  numberOfBranches?: number;  // ✅ YENİ ALAN
  metadata?: {
    // ...
  };
  notes?: string;
  isVip?: boolean;
  contractStartDate?: string;
  contractEndDate?: string;
}
```

**Not**: `UpdateCustomerDto` zaten `Partial<CreateCustomerDto>` olduğu için otomatik olarak bu alanı içerecektir.

### 1.3 CustomerResponseDto Güncellemesi (API Response Type)

**Dosya**: `src/api/types/customer.types.ts` (veya ilgili API types dosyası)

API response type'ına alanı ekleyin:

```typescript
export interface CustomerResponseDto {
  id: string;
  code: string;
  name: string;
  channel: string;
  type: string;
  status: string;
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  customerTier?: string;
  numberOfBranches?: number;  // ✅ YENİ ALAN
  isVip: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 2. Zod Schema Güncellemesi

### 2.1 Customer Schema Güncellemesi

**Dosya**: `src/schemas/customer.schema.ts`

`createCustomerSchema`'ya `numberOfBranches` alanını ekleyin:

```typescript
import { z } from 'zod';
import {
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '@/types/customer.types';

export const createCustomerSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(2, 'Name must be at least 2 characters').max(200),
  channel: z.nativeEnum(CustomerChannel),
  type: z.nativeEnum(CustomerType).optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  // ... diğer alanlar ...
  firstOrderDate: z.string().optional(),
  numberOfBranches: z.number().int().min(0, 'Number of branches must be 0 or greater').optional(),  // ✅ YENİ ALAN
  metadata: z
    .object({
      // ...
    })
    .optional(),
  notes: z.string().optional(),
  isVip: z.boolean().optional(),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerFormData = z.infer<typeof updateCustomerSchema>;
```

**Açıklama**: 
- `z.number().int()` - Sadece tam sayı değerleri kabul eder
- `.min(0)` - Negatif değerleri engeller
- `.optional()` - Alan opsiyoneldir

---

## 3. Form Component Güncellemesi

### 3.1 CustomerForm Component'ine Alan Ekleme

**Dosya**: `src/components/forms/CustomerForm.tsx`

Form'a `numberOfBranches` input alanını ekleyin. Örnek konum: "İş Detayları" veya "Finansal Bilgiler" bölümünde.

```typescript
// components/forms/CustomerForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  createCustomerSchema,
  CreateCustomerFormData,
} from '@/schemas/customer.schema';
import { useCreateCustomer, useUpdateCustomer } from '@/services/customers.service';
import { Customer } from '@/types/customer.types';

export function CustomerForm({ customer, onSuccess, onCancel }: CustomerFormProps) {
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();

  const form = useForm<CreateCustomerFormData>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: customer
      ? {
          code: customer.code,
          name: customer.name,
          channel: customer.channel,
          type: customer.type,
          status: customer.status,
          // ... diğer alanlar ...
          numberOfBranches: customer.numberOfBranches,  // ✅ YENİ ALAN
        }
      : {
          channel: CustomerChannel.RETAIL,
          type: CustomerType.DIRECT,
          status: CustomerStatus.ACTIVE,
        },
  });

  const onSubmit = async (data: CreateCustomerFormData) => {
    try {
      if (customer) {
        await updateMutation.mutateAsync({ id: customer.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save customer:', error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* ... diğer form alanları ... */}

        {/* ✅ YENİ ALAN - Şube Sayısı */}
        <FormField
          control={form.control}
          name="numberOfBranches"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Şube Sayısı</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Örn: 5"
                  {...field}
                  onChange={(e) => {
                    const value = e.target.value;
                    field.onChange(value === '' ? undefined : parseInt(value, 10));
                  }}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormDescription>
                Müşterinin toplam şube sayısını girin
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ... diğer form alanları ... */}

        <div className="flex justify-end space-x-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              İptal
            </Button>
          )}
          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            {customer ? 'Güncelle' : 'Oluştur'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

**Önemli Notlar**:
- `type="number"` kullanarak sadece sayısal değer girişi sağlanır
- `min="0"` ile negatif değerler engellenir
- `step="1"` ile sadece tam sayılar kabul edilir
- `onChange` handler'ında boş değer için `undefined` döndürülür (opsiyonel alan için)

---

## 4. List/Table Component Güncellemesi

### 4.1 CustomerList/Table Component'ine Kolon Ekleme

**Dosya**: `src/components/features/customers/CustomerList.tsx` veya `CustomerTable.tsx`

Müşteri listesi/tablosuna `numberOfBranches` kolonunu ekleyin:

```typescript
// components/features/customers/CustomerTable.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Customer } from '@/types/customer.types';

interface CustomerTableProps {
  customers: Customer[];
}

export function CustomerTable({ customers }: CustomerTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kod</TableHead>
          <TableHead>İsim</TableHead>
          <TableHead>Kanal</TableHead>
          <TableHead>Şehir</TableHead>
          <TableHead>Şube Sayısı</TableHead>  {/* ✅ YENİ KOLON */}
          <TableHead>Durum</TableHead>
          <TableHead>İşlemler</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell>{customer.code}</TableCell>
            <TableCell>{customer.name}</TableCell>
            <TableCell>{customer.channel}</TableCell>
            <TableCell>{customer.city || '-'}</TableCell>
            <TableCell>
              {customer.numberOfBranches !== undefined 
                ? customer.numberOfBranches 
                : '-'}  {/* ✅ YENİ ALAN */}
            </TableCell>
            <TableCell>
              <Badge variant={customer.status === CustomerStatus.ACTIVE ? 'success' : 'secondary'}>
                {customer.status}
              </Badge>
            </TableCell>
            <TableCell>
              {/* İşlem butonları */}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

---

## 5. Detail Component Güncellemesi

### 5.1 CustomerDetail Component'ine Alan Ekleme

**Dosya**: `src/components/features/customers/CustomerDetail.tsx`

Müşteri detay sayfasına `numberOfBranches` bilgisini ekleyin:

```typescript
// components/features/customers/CustomerDetail.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Customer } from '@/types/customer.types';

interface CustomerDetailProps {
  customer: Customer;
}

export function CustomerDetail({ customer }: CustomerDetailProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Genel Bilgiler</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Kod</label>
              <p className="text-sm">{customer.code}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">İsim</label>
              <p className="text-sm">{customer.name}</p>
            </div>
            {/* ... diğer alanlar ... */}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>İş Detayları</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            {/* ... diğer alanlar ... */}
            
            {/* ✅ YENİ ALAN */}
            <div>
              <label className="text-sm font-medium text-gray-500">Şube Sayısı</label>
              <p className="text-sm">
                {customer.numberOfBranches !== undefined 
                  ? customer.numberOfBranches 
                  : 'Belirtilmemiş'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## 6. Card Component Güncellemesi (Opsiyonel)

### 6.1 CustomerCard Component'ine Alan Ekleme

**Dosya**: `src/components/features/customers/CustomerCard.tsx`

Eğer müşteri kartları kullanıyorsanız, kartlara da alanı ekleyebilirsiniz:

```typescript
// components/features/customers/CustomerCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Customer } from '@/types/customer.types';

interface CustomerCardProps {
  customer: Customer;
  onClick?: () => void;
}

export function CustomerCard({ customer, onClick }: CustomerCardProps) {
  return (
    <Card onClick={onClick} className="cursor-pointer hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>{customer.name}</span>
          <Badge>{customer.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Kod:</span> {customer.code}</p>
          <p><span className="font-medium">Kanal:</span> {customer.channel}</p>
          {customer.city && (
            <p><span className="font-medium">Şehir:</span> {customer.city}</p>
          )}
          {/* ✅ YENİ ALAN */}
          {customer.numberOfBranches !== undefined && (
            <p><span className="font-medium">Şube Sayısı:</span> {customer.numberOfBranches}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 7. API Endpoints Kontrolü

### 7.1 Endpoints Dosyası Kontrolü

**Dosya**: `src/api/endpoints/customers.endpoints.ts`

API endpoints dosyasında özel bir değişiklik yapmanıza gerek yok. Backend zaten bu alanı destekliyor. Ancak TypeScript tip kontrolü için response type'larını güncellediğinizden emin olun.

```typescript
// api/endpoints/customers.endpoints.ts
import { apiClient } from '../client';
import { CreateCustomerDto, UpdateCustomerDto, CustomerFilterDto, CustomerResponseDto } from '../types/customer.types';

export const customerEndpoints = {
  getAll: (filters?: CustomerFilterDto) =>
    apiClient.get<CustomerResponseDto[]>('/customers', { params: filters }),
  
  getById: (id: string) =>
    apiClient.get<CustomerResponseDto>(`/customers/${id}`),
  
  create: (data: CreateCustomerDto) =>
    apiClient.post<CustomerResponseDto>('/customers', data),
  
  update: (id: string, data: UpdateCustomerDto) =>
    apiClient.patch<CustomerResponseDto>(`/customers/${id}`, data),
  
  // ... diğer endpointler
};
```

---

## 8. Test Senaryoları

### 8.1 Form Validation Testi

```typescript
// __tests__/components/forms/CustomerForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerForm } from '@/components/forms/CustomerForm';

describe('CustomerForm - numberOfBranches', () => {
  it('should accept valid number of branches', async () => {
    render(<CustomerForm onSuccess={jest.fn()} />);
    
    const branchesInput = screen.getByLabelText(/şube sayısı/i);
    fireEvent.change(branchesInput, { target: { value: '5' } });
    
    await waitFor(() => {
      expect(branchesInput).toHaveValue(5);
    });
  });

  it('should reject negative values', async () => {
    render(<CustomerForm onSuccess={jest.fn()} />);
    
    const branchesInput = screen.getByLabelText(/şube sayısı/i);
    fireEvent.change(branchesInput, { target: { value: '-1' } });
    
    await waitFor(() => {
      expect(screen.getByText(/must be 0 or greater/i)).toBeInTheDocument();
    });
  });

  it('should allow empty value (optional field)', async () => {
    render(<CustomerForm onSuccess={jest.fn()} />);
    
    const branchesInput = screen.getByLabelText(/şube sayısı/i);
    fireEvent.change(branchesInput, { target: { value: '' } });
    
    await waitFor(() => {
      expect(branchesInput).toHaveValue('');
    });
  });
});
```

---

## 9. Özet - Yapılacaklar Listesi

### ✅ Backend (Tamamlandı)
- [x] Customer entity'ye `numberOfBranches` alanı eklendi
- [x] CreateCustomerDto'ya alan eklendi
- [x] CustomerResponseDto'ya alan eklendi
- [x] Migration dosyası oluşturuldu

### 📝 Frontend (Yapılacaklar)

1. **TypeScript Types**
   - [ ] `Customer` interface'ine `numberOfBranches?: number` ekle
   - [ ] `CreateCustomerDto` interface'ine `numberOfBranches?: number` ekle
   - [ ] `CustomerResponseDto` interface'ine `numberOfBranches?: number` ekle

2. **Zod Schema**
   - [ ] `createCustomerSchema`'ya `numberOfBranches` validation ekle

3. **Form Component**
   - [ ] `CustomerForm` component'ine input alanı ekle
   - [ ] Form default values'a `numberOfBranches` ekle

4. **List/Table Component**
   - [ ] `CustomerTable` component'ine kolon ekle

5. **Detail Component**
   - [ ] `CustomerDetail` component'ine alan ekle

6. **Card Component (Opsiyonel)**
   - [ ] `CustomerCard` component'ine alan ekle

7. **Test**
   - [ ] Form validation testleri yaz
   - [ ] Component render testleri yaz

---

## 10. Örnek API Response

Backend'den dönen response örneği:

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "code": "CUST001",
  "name": "Metro Türkiye",
  "channel": "NKA",
  "type": "DIRECT",
  "status": "ACTIVE",
  "city": "Istanbul",
  "numberOfBranches": 5,
  "isVip": true,
  "tenantId": "tenant-uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 11. Notlar ve İpuçları

1. **Null/Undefined Kontrolü**: Alan opsiyonel olduğu için her zaman `undefined` kontrolü yapın:
   ```typescript
   {customer.numberOfBranches !== undefined ? customer.numberOfBranches : '-'}
   ```

2. **Form Input Handling**: Number input için özel onChange handler kullanın:
   ```typescript
   onChange={(e) => {
     const value = e.target.value;
     field.onChange(value === '' ? undefined : parseInt(value, 10));
   }}
   ```

3. **Validation**: Zod schema'da `.int()` ve `.min(0)` kullanarak sadece pozitif tam sayıları kabul edin.

4. **UI/UX**: 
   - Input'a `placeholder` ekleyerek kullanıcıya örnek değer gösterin
   - `FormDescription` ile alan hakkında açıklama ekleyin
   - Tabloda boş değerler için `-` veya `Belirtilmemiş` gösterin

---

## 12. Sorun Giderme

### Problem: Form submit edildiğinde numberOfBranches undefined oluyor
**Çözüm**: Input'un onChange handler'ında string'i number'a çevirdiğinizden emin olun.

### Problem: TypeScript hatası - Property 'numberOfBranches' does not exist
**Çözüm**: Customer interface'ini güncellediğinizden emin olun ve TypeScript server'ı yeniden başlatın.

### Problem: Backend'den gelen data'da numberOfBranches yok
**Çözüm**: Migration'ı çalıştırdığınızdan emin olun: `npm run migration:run`

---

**Son Güncelleme**: 2024-01-XX
**Backend Versiyonu**: ✅ Hazır
**Frontend Durumu**: 📝 Implementasyon gerekli



