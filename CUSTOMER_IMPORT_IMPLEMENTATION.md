# Müşteri Toplu İçe Aktarma (Excel/CSV Import) - React Frontend Implementasyonu

## Genel Bakış

Bu döküman, backend'de oluşturulan Excel/CSV import özelliğini React frontend projesine entegre etmek için gerekli tüm adımları içermektedir.

**Backend Durumu**: ✅ Backend'de endpoint hazır ve çalışır durumda.
- Endpoint: `POST /customers/import`
- Desteklenen formatlar: Excel (.xlsx, .xls) ve CSV (.csv)

---

## 1. API Service Oluşturma

### 1.1 Import Endpoint Ekleme

**Dosya**: `src/api/services/customer.service.ts` veya ilgili API service dosyası

```typescript
import { apiClient } from '../client';

export interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{
    row: number;
    code: string;
    error: string;
  }>;
}

export const customerService = {
  // ... mevcut metodlar ...

  importFromFile: async (file: File): Promise<ImportResult> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<ImportResult>('/customers/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  },
};
```

**Not**: `apiClient`'ın axios instance olduğunu varsayıyoruz. Eğer farklı bir HTTP client kullanıyorsanız, buna göre adapte edin.

---

## 2. React Hook Oluşturma (React Query / TanStack Query)

### 2.1 Import Hook

**Dosya**: `src/hooks/useCustomerImport.ts` veya `src/services/hooks/useCustomers.ts`

```typescript
import { useMutation } from '@tanstack/react-query';
import { customerService, ImportResult } from '@/api/services/customer.service';
import { useToast } from '@/hooks/useToast'; // veya toast kütüphaneniz

export const useCustomerImport = () => {
  const toast = useToast(); // veya toast hook'unuz

  return useMutation({
    mutationFn: (file: File) => customerService.importFromFile(file),
    onSuccess: (data: ImportResult) => {
      const { total, created, skipped, errors } = data;
      
      if (created === total) {
        toast.success(`Tüm ${total} müşteri başarıyla içe aktarıldı.`);
      } else if (created > 0) {
        toast.warning(
          `${created} müşteri içe aktarıldı, ${skipped} müşteri atlandı.`,
        );
      } else {
        toast.error('Hiçbir müşteri içe aktarılamadı.');
      }

      // Hataları göster
      if (errors.length > 0) {
        console.error('Import hataları:', errors);
        // İsteğe bağlı: Hataları modal veya detaylı bir şekilde gösterebilirsiniz
      }
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.message || error.message || 'Dosya yüklenirken bir hata oluştu';
      toast.error(errorMessage);
    },
  });
};
```

---

## 3. File Upload Component

### 3.1 Import Button/Modal Component

**Dosya**: `src/components/customers/CustomerImportButton.tsx`

```typescript
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useCustomerImport } from '@/hooks/useCustomerImport';
import { Upload, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function CustomerImportButton() {
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const importMutation = useCustomerImport();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Dosya formatı kontrolü
      const allowedExtensions = ['xlsx', 'xls', 'csv'];
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
        alert('Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.');
        return;
      }

      // Dosya boyutu kontrolü (opsiyonel, örn: 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('Dosya boyutu 10MB\'dan büyük olamaz.');
        return;
      }

      setSelectedFile(file);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    try {
      await importMutation.mutateAsync(selectedFile);
      setIsOpen(false);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      // Error handling hook'ta yapılıyor
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Toplu İçe Aktar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Müşteri Toplu İçe Aktarma</DialogTitle>
          <DialogDescription>
            Excel (.xlsx, .xls) veya CSV (.csv) dosyası yükleyerek müşterileri toplu olarak ekleyebilirsiniz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label
              htmlFor="file-upload"
              className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                {selectedFile ? (
                  <>
                    {selectedFile.name.endsWith('.csv') ? (
                      <FileText className="w-10 h-10 text-blue-500 mb-2" />
                    ) : (
                      <FileSpreadsheet className="w-10 h-10 text-green-500 mb-2" />
                    )}
                    <p className="mb-2 text-sm text-gray-500">
                      <span className="font-semibold">{selectedFile.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400 mb-2" />
                    <p className="mb-2 text-sm text-gray-500">
                      <span className="font-semibold">Dosya seçmek için tıklayın</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Excel (.xlsx, .xls) veya CSV (.csv)
                    </p>
                  </>
                )}
              </div>
              <input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                disabled={importMutation.isPending}
              />
            </label>
          </div>

          {selectedFile && (
            <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-md">
              <p className="font-medium mb-1">Seçilen dosya:</p>
              <p>{selectedFile.name}</p>
              <p className="text-xs mt-1">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={importMutation.isPending}
            >
              İptal
            </Button>
            <Button
              onClick={handleImport}
              disabled={!selectedFile || importMutation.isPending}
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Yükleniyor...
                </>
              ) : (
                'İçe Aktar'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 4. Import Sonuçları Modal (Opsiyonel - Detaylı Hata Gösterimi)

### 4.1 Import Results Component

**Dosya**: `src/components/customers/CustomerImportResults.tsx`

```typescript
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportResult } from '@/api/services/customer.service';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CustomerImportResultsProps {
  result: ImportResult;
  isOpen: boolean;
  onClose: () => void;
}

export function CustomerImportResults({
  result,
  isOpen,
  onClose,
}: CustomerImportResultsProps) {
  const { total, created, skipped, errors } = result;
  const successRate = total > 0 ? ((created / total) * 100).toFixed(1) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>İçe Aktarma Sonuçları</DialogTitle>
          <DialogDescription>
            Toplu içe aktarma işlemi tamamlandı
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Özet İstatistikler */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{total}</p>
              <p className="text-sm text-gray-600">Toplam</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{created}</p>
              <p className="text-sm text-gray-600">Başarılı</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{skipped}</p>
              <p className="text-sm text-gray-600">Atlandı</p>
            </div>
          </div>

          {/* Başarı Oranı */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            {parseFloat(successRate) === 100 ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : parseFloat(successRate) > 50 ? (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm font-medium">
              Başarı Oranı: %{successRate}
            </span>
          </div>

          {/* Hatalar Listesi */}
          {errors.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">
                Hatalar ({errors.length})
              </h4>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Satır</th>
                      <th className="px-3 py-2 text-left">Kod</th>
                      <th className="px-3 py-2 text-left">Hata</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {errors.map((error, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{error.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {error.code}
                        </td>
                        <td className="px-3 py-2 text-red-600">
                          {error.error}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={onClose}>Kapat</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 5. Hook'u Güncelleme (Detaylı Sonuç Gösterimi İçin)

### 5.1 Güncellenmiş Import Hook

```typescript
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { customerService, ImportResult } from '@/api/services/customer.service';
import { useToast } from '@/hooks/useToast';

export const useCustomerImport = () => {
  const toast = useToast();
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showResults, setShowResults] = useState(false);

  const mutation = useMutation({
    mutationFn: (file: File) => customerService.importFromFile(file),
    onSuccess: (data: ImportResult) => {
      setImportResult(data);
      setShowResults(true);

      const { total, created, skipped } = data;
      
      if (created === total) {
        toast.success(`Tüm ${total} müşteri başarıyla içe aktarıldı.`);
      } else if (created > 0) {
        toast.warning(
          `${created} müşteri içe aktarıldı, ${skipped} müşteri atlandı. Detaylar için sonuçları kontrol edin.`,
        );
      } else {
        toast.error('Hiçbir müşteri içe aktarılamadı. Lütfen sonuçları kontrol edin.');
      }
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.message || error.message || 'Dosya yüklenirken bir hata oluştu';
      toast.error(errorMessage);
    },
  });

  return {
    ...mutation,
    importResult,
    showResults,
    setShowResults,
  };
};
```

---

## 6. Customer List Sayfasına Entegrasyon

### 6.1 Customer List Component Güncelleme

**Dosya**: `src/pages/customers/CustomerListPage.tsx` veya ilgili sayfa

```typescript
import React from 'react';
import { CustomerImportButton } from '@/components/customers/CustomerImportButton';
import { CustomerImportResults } from '@/components/customers/CustomerImportResults';
import { useCustomerImport } from '@/hooks/useCustomerImport';
import { useQueryClient } from '@tanstack/react-query';

export function CustomerListPage() {
  const queryClient = useQueryClient();
  const { importResult, showResults, setShowResults } = useCustomerImport();

  // Import sonrası listeyi yenile
  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Müşteriler</h1>
        <div className="flex gap-2">
          <CustomerImportButton />
          {/* Diğer butonlar */}
        </div>
      </div>

      {/* Import sonuçları modal */}
      {importResult && (
        <CustomerImportResults
          result={importResult}
          isOpen={showResults}
          onClose={() => {
            setShowResults(false);
            handleImportSuccess();
          }}
        />
      )}

      {/* Müşteri listesi */}
      {/* ... */}
    </div>
  );
}
```

---

## 7. Excel/CSV Template Dosyası

### 7.1 Örnek Excel/CSV Formatı

Kullanıcıların kullanabileceği bir template dosyası oluşturun. Minimum gerekli kolonlar:

**Excel/CSV Template Kolonları:**

| code | name | channel | type | status | city | district | contactPerson | contactEmail | contactPhone | numberOfBranches |
|------|------|---------|------|--------|------|----------|---------------|--------------|--------------|------------------|
| CUST001 | Metro Türkiye | NKA | DIRECT | ACTIVE | Istanbul | Beşiktaş | Ahmet Yılmaz | ahmet@metro.com | +90 212 555 1234 | 5 |
| CUST002 | Migros | RETAIL | DIRECT | ACTIVE | Istanbul | Kadıköy | Ayşe Demir | ayse@migros.com | +90 216 555 5678 | 10 |

**Desteklenen Tüm Kolonlar:**

- **Zorunlu**: `code`, `name`, `channel`
- **Opsiyonel**: 
  - `type`, `status`
  - `city`, `district`, `region`, `country`, `address`, `postalCode`
  - `taxNumber`, `taxOffice`, `companyRegistrationNumber`
  - `contactPerson`, `contactEmail`, `contactPhone`, `contactMobile`
  - `paymentTerms`, `creditLimit`, `currency`
  - `salesRepresentative`, `accountManager`
  - `customerGroup`, `customerSegment`, `customerTier`, `businessSize`
  - `annualRevenue`, `numberOfBranches`
  - `lastOrderDate`, `firstOrderDate` (YYYY-MM-DD formatında)
  - `contractStartDate`, `contractEndDate` (YYYY-MM-DD formatında)
  - `isVip` (true/false), `notes`
  - `storeSize`, `numberOfEmployees`, `industry` (metadata)

**Channel Değerleri:**
- `NKA`, `TRADITIONAL_TRADE`, `E_COMMERCE`, `EXPORT`, `WHOLESALE`, `RETAIL`, `HORECA`

**Type Değerleri:**
- `DIRECT`, `DISTRIBUTOR`, `WHOLESALER`, `RETAILER`, `END_CUSTOMER`

**Status Değerleri:**
- `ACTIVE`, `INACTIVE`, `PENDING`, `SUSPENDED`

---

## 8. Template İndirme Özelliği (Opsiyonel)

### 8.1 Template Download Component

```typescript
import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';

export function DownloadTemplateButton() {
  const handleDownload = () => {
    // Template data
    const templateData = [
      {
        code: 'CUST001',
        name: 'Örnek Müşteri',
        channel: 'RETAIL',
        type: 'DIRECT',
        status: 'ACTIVE',
        city: 'Istanbul',
        district: 'Beşiktaş',
        contactPerson: 'Ahmet Yılmaz',
        contactEmail: 'ahmet@example.com',
        contactPhone: '+90 212 555 1234',
        numberOfBranches: 5,
      },
    ];

    // Excel dosyası oluştur
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Müşteriler');
    
    // İndir
    XLSX.writeFile(wb, 'musteri_template.xlsx');
  };

  return (
    <Button variant="outline" onClick={handleDownload} className="gap-2">
      <Download className="h-4 w-4" />
      Template İndir
    </Button>
  );
}
```

**Not**: Template indirme için `xlsx` paketini frontend'e de eklemeniz gerekebilir:
```bash
npm install xlsx
```

---

## 9. Validation ve Error Handling

### 9.1 Client-Side Validation

```typescript
const validateFile = (file: File): { valid: boolean; error?: string } => {
  // Dosya formatı kontrolü
  const allowedExtensions = ['xlsx', 'xls', 'csv'];
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  
  if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
    return {
      valid: false,
      error: 'Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
    };
  }

  // Dosya boyutu kontrolü (10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'Dosya boyutu 10MB\'dan büyük olamaz.',
    };
  }

  return { valid: true };
};
```

---

## 10. Özet - Yapılacaklar Listesi

### ✅ Backend (Tamamlandı)
- [x] Import endpoint oluşturuldu
- [x] Excel/CSV parser service hazır
- [x] Error handling implementasyonu

### 📝 Frontend (Yapılacaklar)

1. **API Service**
   - [ ] `importFromFile` metodu ekle
   - [ ] `ImportResult` interface tanımla

2. **React Hook**
   - [ ] `useCustomerImport` hook oluştur
   - [ ] React Query mutation yapılandır
   - [ ] Success/error handling ekle

3. **Components**
   - [ ] `CustomerImportButton` component oluştur
   - [ ] File upload UI ekle
   - [ ] Loading state yönetimi
   - [ ] (Opsiyonel) `CustomerImportResults` component

4. **Sayfa Entegrasyonu**
   - [ ] Customer list sayfasına import butonu ekle
   - [ ] Import sonrası listeyi yenile
   - [ ] (Opsiyonel) Template indirme butonu

5. **Template**
   - [ ] Excel template dosyası oluştur
   - [ ] CSV template dosyası oluştur
   - [ ] (Opsiyonel) Template indirme özelliği

6. **Test**
   - [ ] Import işlemini test et
   - [ ] Error handling test et
   - [ ] Success/error mesajlarını kontrol et

---

## 11. API Endpoint Detayları

### Endpoint
```
POST /customers/import
```

### Headers
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### Request Body
```
FormData:
  file: File (Excel veya CSV)
```

### Response (Success - 201)
```json
{
  "total": 100,
  "created": 95,
  "skipped": 5,
  "errors": [
    {
      "row": 3,
      "code": "CUST001",
      "error": "Bu kod ile müşteri zaten mevcut"
    },
    {
      "row": 7,
      "code": "CUST002",
      "error": "Geçersiz channel değeri"
    }
  ]
}
```

### Response (Error - 400)
```json
{
  "statusCode": 400,
  "message": "Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.",
  "error": "Bad Request"
}
```

---

## 12. Notlar ve İpuçları

1. **Dosya Boyutu**: Büyük dosyalar için progress bar ekleyebilirsiniz
2. **Chunk Upload**: Çok büyük dosyalar için backend'de chunk upload implementasyonu gerekebilir
3. **Preview**: Import öncesi dosya içeriğini önizleme özelliği eklenebilir
4. **Validation**: Client-side'da dosya formatı ve boyut kontrolü yapın
5. **Error Display**: Hataları kullanıcıya anlaşılır şekilde gösterin
6. **Refresh**: Import sonrası müşteri listesini otomatik yenileyin
7. **Template**: Kullanıcılara örnek template dosyası sağlayın

---

**Son Güncelleme**: 2024-01-XX
**Backend Versiyonu**: ✅ Hazır
**Frontend Durumu**: 📝 Implementasyon gerekli



