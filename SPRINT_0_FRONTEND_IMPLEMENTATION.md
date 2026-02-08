# Sprint 0 Frontend Implementation Guide
## React.js Integration for Backend Changes

**Date:** January 2026  
**Status:** 📝 Development Ready  
**Backend Status:** ✅ Completed

---

## 📋 Overview

This document provides complete implementation guide for React.js frontend to integrate with Sprint 0 backend changes. All API endpoints, types, and integration patterns are documented.

---

## 🎯 Backend Changes Summary

### 1. **AI-001: Customer Import Error Handling** ✅
- Enhanced error response format
- Partial success with detailed error reports
- Validation before insert

### 2. **MC-001: Budget Module** ✅
- Budget envelope management
- Budget reservation with concurrency control
- Approval workflow

### 3. **MC-002: Notification Module** ✅
- 6 core notification types
- Email + In-app notifications
- Notification center

### 4. **EA-001: Admin Role Restrictions** ✅
- Admin action restrictions
- Audit logging

---

## 📦 1. Customer Import Enhancement (AI-001)

### 1.1 Updated API Response Format

**Endpoint:** `POST /customers/import`

**Updated Response:**
```typescript
interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{
    row: number;
    code: string;
    error_type: 'MISSING_FIELD' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'ALREADY_EXISTS' | 'DUPLICATE_IN_FILE' | 'DATABASE_ERROR' | 'INVALID_EMAIL';
    error_message: string;
    original_row_data?: Record<string, any>;
  }>;
}
```

### 1.2 TypeScript Types

**File:** `src/types/customer.types.ts`

```typescript
export enum ImportErrorType {
  MISSING_FIELD = 'MISSING_FIELD',
  INVALID_DATE = 'INVALID_DATE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INVALID_EMAIL = 'INVALID_EMAIL',
}

export interface ImportError {
  row: number;
  code: string;
  error_type: ImportErrorType;
  error_message: string;
  original_row_data?: Record<string, any>;
}

export interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: ImportError[];
}
```

### 1.3 API Service Update

**File:** `src/api/services/customer.service.ts`

```typescript
import { apiClient } from '../client';
import { ImportResult } from '@/types/customer.types';

export const customerService = {
  // ... existing methods ...

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

### 1.4 React Hook Update

**File:** `src/hooks/useCustomerImport.ts`

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

      const { total, created, skipped, errors } = data;
      
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

### 1.5 Enhanced Import Results Component

**File:** `src/components/customers/CustomerImportResults.tsx`

```typescript
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportResult, ImportErrorType } from '@/types/customer.types';
import { CheckCircle2, XCircle, AlertCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';

interface CustomerImportResultsProps {
  result: ImportResult;
  isOpen: boolean;
  onClose: () => void;
}

const getErrorTypeLabel = (type: ImportErrorType): string => {
  const labels: Record<ImportErrorType, string> = {
    MISSING_FIELD: 'Eksik Alan',
    INVALID_DATE: 'Geçersiz Tarih',
    INVALID_AMOUNT: 'Geçersiz Tutar',
    ALREADY_EXISTS: 'Zaten Mevcut',
    DUPLICATE_IN_FILE: 'Dosyada Tekrar',
    DATABASE_ERROR: 'Veritabanı Hatası',
    INVALID_EMAIL: 'Geçersiz Email',
  };
  return labels[type] || type;
};

const getErrorTypeColor = (type: ImportErrorType): string => {
  const colors: Record<ImportErrorType, string> = {
    MISSING_FIELD: 'text-yellow-600 bg-yellow-50',
    INVALID_DATE: 'text-orange-600 bg-orange-50',
    INVALID_AMOUNT: 'text-orange-600 bg-orange-50',
    ALREADY_EXISTS: 'text-blue-600 bg-blue-50',
    DUPLICATE_IN_FILE: 'text-purple-600 bg-purple-50',
    DATABASE_ERROR: 'text-red-600 bg-red-50',
    INVALID_EMAIL: 'text-pink-600 bg-pink-50',
  };
  return colors[type] || 'text-gray-600 bg-gray-50';
};

export function CustomerImportResults({
  result,
  isOpen,
  onClose,
}: CustomerImportResultsProps) {
  const { total, created, skipped, errors } = result;
  const successRate = total > 0 ? ((created / total) * 100).toFixed(1) : 0;

  const downloadErrorReport = () => {
    const errorData = errors.map((error) => ({
      Satır: error.row,
      Kod: error.code,
      'Hata Tipi': getErrorTypeLabel(error.error_type),
      'Hata Mesajı': error.error_message,
      ...error.original_row_data,
    }));

    const ws = XLSX.utils.json_to_sheet(errorData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hatalar');
    XLSX.writeFile(wb, `import_hatalari_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
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
              <div className="flex justify-between items-center">
                <h4 className="font-medium text-sm text-gray-700">
                  Hatalar ({errors.length})
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadErrorReport}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Hata Raporunu İndir
                </Button>
              </div>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Satır</th>
                      <th className="px-3 py-2 text-left">Kod</th>
                      <th className="px-3 py-2 text-left">Hata Tipi</th>
                      <th className="px-3 py-2 text-left">Hata Mesajı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {errors.map((error, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{error.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {error.code}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getErrorTypeColor(
                              error.error_type,
                            )}`}
                          >
                            {getErrorTypeLabel(error.error_type)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-red-600">
                          {error.error_message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
            {errors.length > 0 && (
              <Button onClick={downloadErrorReport} className="gap-2">
                <Download className="h-4 w-4" />
                Hata Raporunu İndir
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 💰 2. Budget Module (MC-001)

### 2.1 TypeScript Types

**File:** `src/types/budget.types.ts`

```typescript
export enum BudgetEnvelopeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  ARCHIVED = 'ARCHIVED',
}

export enum BudgetReservationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMMITTED = 'COMMITTED',
  CANCELLED = 'CANCELLED',
}

export interface BudgetEnvelope {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  fiscalYear: string;
  period: string;
  allocatedAmount: number;
  consumedAmount: number;
  availableAmount: number;
  status: BudgetEnvelopeStatus;
  budgetOwnerId?: string;
  budgetOwnerEmail?: string;
  budgetOwnerName?: string;
  currency: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetReservation {
  id: string;
  tenantId: string;
  envelopeId: string;
  agreementId?: string;
  agreementName?: string;
  reservedAmount: number;
  status: BudgetReservationStatus;
  requestedById: string;
  requestedByEmail: string;
  requestedByName: string;
  approvedById?: string;
  approvedAt?: Date;
  rejectedReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBudgetEnvelopeDto {
  code: string;
  name: string;
  fiscalYear: string;
  period: string;
  allocatedAmount: number;
  status?: BudgetEnvelopeStatus;
  budgetOwnerId?: string;
  budgetOwnerEmail?: string;
  budgetOwnerName?: string;
  currency?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ReserveBudgetDto {
  envelopeId: string;
  amount: number;
  agreementId?: string;
  agreementName?: string;
  notes?: string;
}
```

### 2.2 API Service

**File:** `src/api/services/budget.service.ts`

```typescript
import { apiClient } from '../client';
import {
  BudgetEnvelope,
  BudgetReservation,
  CreateBudgetEnvelopeDto,
  ReserveBudgetDto,
} from '@/types/budget.types';

export const budgetService = {
  // Budget Envelopes
  createEnvelope: async (data: CreateBudgetEnvelopeDto): Promise<BudgetEnvelope> => {
    const response = await apiClient.post<BudgetEnvelope>('/budget/envelopes', data);
    return response.data;
  },

  getAllEnvelopes: async (): Promise<BudgetEnvelope[]> => {
    const response = await apiClient.get<BudgetEnvelope[]>('/budget/envelopes');
    return response.data;
  },

  getEnvelopeById: async (id: string): Promise<BudgetEnvelope> => {
    const response = await apiClient.get<BudgetEnvelope>(`/budget/envelopes/${id}`);
    return response.data;
  },

  // Budget Reservations
  reserveBudget: async (data: ReserveBudgetDto): Promise<BudgetReservation> => {
    const response = await apiClient.post<BudgetReservation>('/budget/reserve', data);
    return response.data;
  },

  approveReservation: async (id: string): Promise<BudgetReservation> => {
    const response = await apiClient.post<BudgetReservation>(
      `/budget/reservations/${id}/approve`,
    );
    return response.data;
  },

  rejectReservation: async (id: string, reason: string): Promise<BudgetReservation> => {
    const response = await apiClient.post<BudgetReservation>(
      `/budget/reservations/${id}/reject`,
      { reason },
    );
    return response.data;
  },

  getReservationsByEnvelope: async (envelopeId: string): Promise<BudgetReservation[]> => {
    const response = await apiClient.get<BudgetReservation[]>(
      `/budget/envelopes/${envelopeId}/reservations`,
    );
    return response.data;
  },
};
```

### 2.3 React Hooks

**File:** `src/hooks/useBudget.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { budgetService } from '@/api/services/budget.service';
import {
  BudgetEnvelope,
  BudgetReservation,
  CreateBudgetEnvelopeDto,
  ReserveBudgetDto,
} from '@/types/budget.types';
import { useToast } from '@/hooks/useToast';

export const useBudgetEnvelopes = () => {
  return useQuery({
    queryKey: ['budget', 'envelopes'],
    queryFn: () => budgetService.getAllEnvelopes(),
  });
};

export const useBudgetEnvelope = (id: string) => {
  return useQuery({
    queryKey: ['budget', 'envelopes', id],
    queryFn: () => budgetService.getEnvelopeById(id),
    enabled: !!id,
  });
};

export const useCreateBudgetEnvelope = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (data: CreateBudgetEnvelopeDto) => budgetService.createEnvelope(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget', 'envelopes'] });
      toast.success('Budget envelope başarıyla oluşturuldu');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Budget envelope oluşturulamadı');
    },
  });
};

export const useReserveBudget = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (data: ReserveBudgetDto) => budgetService.reserveBudget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget'] });
      toast.success('Budget başarıyla rezerve edildi');
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.message || 'Budget rezerve edilemedi';
      toast.error(errorMessage);
    },
  });
};

export const useApproveReservation = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => budgetService.approveReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget'] });
      toast.success('Rezervasyon onaylandı');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Rezervasyon onaylanamadı');
    },
  });
};

export const useRejectReservation = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      budgetService.rejectReservation(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget'] });
      toast.success('Rezervasyon reddedildi');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Rezervasyon reddedilemedi');
    },
  });
};

export const useBudgetReservations = (envelopeId: string) => {
  return useQuery({
    queryKey: ['budget', 'envelopes', envelopeId, 'reservations'],
    queryFn: () => budgetService.getReservationsByEnvelope(envelopeId),
    enabled: !!envelopeId,
  });
};
```

### 2.4 Budget Envelope Components

**File:** `src/components/budget/BudgetEnvelopeCard.tsx`

```typescript
import React from 'react';
import { BudgetEnvelope, BudgetEnvelopeStatus } from '@/types/budget.types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface BudgetEnvelopeCardProps {
  envelope: BudgetEnvelope;
  onClick?: () => void;
}

const getStatusColor = (status: BudgetEnvelopeStatus): string => {
  const colors: Record<BudgetEnvelopeStatus, string> = {
    DRAFT: 'bg-gray-100 text-gray-800',
    ACTIVE: 'bg-green-100 text-green-800',
    CLOSED: 'bg-blue-100 text-blue-800',
    ARCHIVED: 'bg-gray-100 text-gray-800',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
};

const getStatusLabel = (status: BudgetEnvelopeStatus): string => {
  const labels: Record<BudgetEnvelopeStatus, string> = {
    DRAFT: 'Taslak',
    ACTIVE: 'Aktif',
    CLOSED: 'Kapatıldı',
    ARCHIVED: 'Arşivlendi',
  };
  return labels[status] || status;
};

export function BudgetEnvelopeCard({ envelope, onClick }: BudgetEnvelopeCardProps) {
  const consumptionPercent = envelope.allocatedAmount > 0
    ? (envelope.consumedAmount / envelope.allocatedAmount) * 100
    : 0;

  const isNearLimit = consumptionPercent >= 80;
  const isOverLimit = consumptionPercent >= 100;

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${
        isOverLimit ? 'border-red-300' : isNearLimit ? 'border-yellow-300' : ''
      }`}
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">{envelope.name}</CardTitle>
          <Badge className={getStatusColor(envelope.status)}>
            {getStatusLabel(envelope.status)}
          </Badge>
        </div>
        <p className="text-sm text-gray-500">{envelope.code}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Kullanım</span>
              <span className="font-medium">
                {consumptionPercent.toFixed(1)}%
              </span>
            </div>
            <Progress
              value={consumptionPercent}
              className={isOverLimit ? 'bg-red-200' : isNearLimit ? 'bg-yellow-200' : ''}
            />
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Ayrılan</p>
              <p className="font-semibold">
                {envelope.allocatedAmount.toLocaleString('tr-TR')} {envelope.currency}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Kullanılan</p>
              <p className="font-semibold">
                {envelope.consumedAmount.toLocaleString('tr-TR')} {envelope.currency}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Kalan</p>
              <p className={`font-semibold ${envelope.availableAmount < 0 ? 'text-red-600' : ''}`}>
                {envelope.availableAmount.toLocaleString('tr-TR')} {envelope.currency}
              </p>
            </div>
          </div>

          {envelope.budgetOwnerName && (
            <div className="text-sm text-gray-500">
              <span className="font-medium">Sorumlu:</span> {envelope.budgetOwnerName}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

**File:** `src/components/budget/ReserveBudgetDialog.tsx`

```typescript
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useReserveBudget } from '@/hooks/useBudget';
import { BudgetEnvelope } from '@/types/budget.types';

interface ReserveBudgetDialogProps {
  envelope: BudgetEnvelope;
  isOpen: boolean;
  onClose: () => void;
}

export function ReserveBudgetDialog({
  envelope,
  isOpen,
  onClose,
}: ReserveBudgetDialogProps) {
  const [amount, setAmount] = useState('');
  const [agreementName, setAgreementName] = useState('');
  const [notes, setNotes] = useState('');
  const reserveBudget = useReserveBudget();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return;
    }

    if (amountNum > envelope.availableAmount) {
      // Error will be handled by the hook
      return;
    }

    await reserveBudget.mutateAsync({
      envelopeId: envelope.id,
      amount: amountNum,
      agreementName: agreementName || undefined,
      notes: notes || undefined,
    });

    onClose();
    setAmount('');
    setAgreementName('');
    setNotes('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Budget Rezerve Et</DialogTitle>
          <DialogDescription>
            {envelope.name} - Kalan: {envelope.availableAmount.toLocaleString('tr-TR')}{' '}
            {envelope.currency}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="amount">Tutar *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={envelope.availableAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Maksimum: {envelope.availableAmount.toLocaleString('tr-TR')} {envelope.currency}
            </p>
          </div>

          <div>
            <Label htmlFor="agreementName">Anlaşma Adı</Label>
            <Input
              id="agreementName"
              value={agreementName}
              onChange={(e) => setAgreementName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={reserveBudget.isPending || !amount || parseFloat(amount) <= 0}
            >
              {reserveBudget.isPending ? 'Rezerve Ediliyor...' : 'Rezerve Et'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 🔔 3. Notification Module (MC-002)

### 3.1 TypeScript Types

**File:** `src/types/notification.types.ts`

```typescript
export enum NotificationType {
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  BUDGET_ALERT_80 = 'BUDGET_ALERT_80',
  BUDGET_ALERT_100 = 'BUDGET_ALERT_100',
  AGREEMENT_EXPIRING = 'AGREEMENT_EXPIRING',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  SMS = 'SMS',
}

export enum NotificationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  READ = 'READ',
}

export interface Notification {
  id: string;
  tenantId: string;
  type: NotificationType;
  recipientId: string;
  recipientEmail: string;
  recipientName?: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  status: NotificationStatus;
  subject: string;
  body: string;
  metadata?: {
    agreementId?: string;
    agreementName?: string;
    budgetEnvelopeId?: string;
    budgetEnvelopeName?: string;
    approverId?: string;
    approverName?: string;
    requesterId?: string;
    requesterName?: string;
    amount?: number;
    [key: string]: any;
  };
  sentAt?: Date;
  readAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 API Service

**File:** `src/api/services/notification.service.ts`

```typescript
import { apiClient } from '../client';
import { Notification } from '@/types/notification.types';

export const notificationService = {
  getAll: async (limit?: number): Promise<Notification[]> => {
    const params = limit ? { limit } : {};
    const response = await apiClient.get<Notification[]>('/notifications', { params });
    return response.data;
  },

  getUnread: async (): Promise<Notification[]> => {
    const response = await apiClient.get<Notification[]>('/notifications/unread');
    return response.data;
  },

  markAsRead: async (id: string): Promise<Notification> => {
    const response = await apiClient.post<Notification>(`/notifications/${id}/read`);
    return response.data;
  },
};
```

### 3.3 React Hooks

**File:** `src/hooks/useNotifications.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@/api/services/notification.service';
import { Notification } from '@/types/notification.types';

export const useNotifications = (limit = 30) => {
  return useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => notificationService.getAll(limit),
  });
};

export const useUnreadNotifications = () => {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationService.getUnread(),
    refetchInterval: 30000, // Poll every 30 seconds
  });
};

export const useMarkNotificationAsRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
};
```

### 3.4 Notification Components

**File:** `src/components/notifications/NotificationCenter.tsx`

```typescript
import React from 'react';
import { Bell } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useUnreadNotifications, useMarkNotificationAsRead } from '@/hooks/useNotifications';
import { NotificationItem } from './NotificationItem';
import { NotificationType } from '@/types/notification.types';

export function NotificationCenter() {
  const { data: unreadNotifications, isLoading } = useUnreadNotifications();
  const markAsRead = useMarkNotificationAsRead();

  const unreadCount = unreadNotifications?.length || 0;

  const handleNotificationClick = (notification: any) => {
    if (!notification.readAt) {
      markAsRead.mutate(notification.id);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="p-2 border-b">
          <h3 className="font-semibold">Bildirimler</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-gray-500">Yükleniyor...</div>
          ) : unreadNotifications && unreadNotifications.length > 0 ? (
            unreadNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
              />
            ))
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">
              Yeni bildirim yok
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**File:** `src/components/notifications/NotificationItem.tsx`

```typescript
import React from 'react';
import { Notification, NotificationType, NotificationPriority } from '@/types/notification.types';
import { CheckCircle2, XCircle, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';

interface NotificationItemProps {
  notification: Notification;
  onClick?: () => void;
}

const getNotificationIcon = (type: NotificationType) => {
  switch (type) {
    case NotificationType.APPROVAL_REQUESTED:
      return <Clock className="h-4 w-4 text-blue-500" />;
    case NotificationType.APPROVAL_GRANTED:
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case NotificationType.APPROVAL_REJECTED:
      return <XCircle className="h-4 w-4 text-red-500" />;
    case NotificationType.BUDGET_ALERT_80:
    case NotificationType.BUDGET_ALERT_100:
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case NotificationType.AGREEMENT_EXPIRING:
      return <Clock className="h-4 w-4 text-orange-500" />;
    default:
      return <Bell className="h-4 w-4 text-gray-500" />;
  }
};

const getPriorityColor = (priority: NotificationPriority): string => {
  const colors: Record<NotificationPriority, string> = {
    LOW: 'border-gray-200',
    MEDIUM: 'border-blue-200',
    HIGH: 'border-red-200',
  };
  return colors[priority] || 'border-gray-200';
};

export function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const isUnread = !notification.readAt;

  return (
    <div
      className={`p-3 border-l-4 cursor-pointer hover:bg-gray-50 transition-colors ${
        isUnread ? 'bg-blue-50' : ''
      } ${getPriorityColor(notification.priority)}`}
      onClick={onClick}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${isUnread ? 'font-semibold' : ''}`}>
            {notification.subject}
          </p>
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
            {notification.body}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
              locale: tr,
            })}
          </p>
        </div>
        {isUnread && (
          <div className="flex-shrink-0">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 🔒 4. Admin Restrictions (EA-001)

### 4.1 Error Handling

Backend'de admin kısıtlamaları uygulandı. Frontend'de bu hataları handle etmek için:

**File:** `src/utils/errorHandler.ts`

```typescript
export const handleAdminRestrictionError = (error: any): string => {
  const message = error.response?.data?.message || error.message;

  if (message.includes('cannot approve')) {
    return 'Admin kullanıcıları kendi oluşturdukları rezervasyonları onaylayamaz.';
  }

  if (message.includes('cannot create agreements')) {
    return 'Admin kullanıcıları anlaşma oluşturamaz. Lütfen Planner rolünü kullanın.';
  }

  if (message.includes('cannot commit budget')) {
    return 'Admin kullanıcıları budget commit edemez. Finance rolü gereklidir.';
  }

  if (message.includes('cannot modify their own role')) {
    return 'Admin kullanıcıları kendi rol izinlerini değiştiremez.';
  }

  return message || 'Bir hata oluştu';
};
```

### 4.2 Role-Based UI Components

**File:** `src/components/common/RoleGuard.tsx`

```typescript
import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { UserRole } from '@/types/user.types';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGuard({ allowedRoles, children, fallback = null }: RoleGuardProps) {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

---

## 📝 5. Implementation Checklist

### Customer Import (AI-001)
- [ ] Update `ImportResult` type with new error format
- [ ] Update `useCustomerImport` hook
- [ ] Enhance `CustomerImportResults` component
- [ ] Add error report download functionality
- [ ] Add error type badges and colors

### Budget Module (MC-001)
- [ ] Create budget types
- [ ] Create budget API service
- [ ] Create budget hooks
- [ ] Create `BudgetEnvelopeCard` component
- [ ] Create `ReserveBudgetDialog` component
- [ ] Create budget list page
- [ ] Create budget detail page
- [ ] Add concurrency error handling

### Notification Module (MC-002)
- [ ] Create notification types
- [ ] Create notification API service
- [ ] Create notification hooks
- [ ] Create `NotificationCenter` component
- [ ] Create `NotificationItem` component
- [ ] Add real-time polling or WebSocket
- [ ] Add notification badge to header
- [ ] Create notification list page

### Admin Restrictions (EA-001)
- [ ] Add error handler for admin restrictions
- [ ] Create `RoleGuard` component
- [ ] Update UI to hide restricted actions for admins
- [ ] Add appropriate error messages

---

## 🚀 Quick Start

1. **Install dependencies:**
```bash
npm install @tanstack/react-query date-fns xlsx
```

2. **Set up API client:**
```typescript
// src/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token interceptor
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

3. **Set up React Query:**
```typescript
// src/providers/QueryProvider.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

---

## 📚 Additional Resources

- **Backend API Documentation:** Check Swagger UI at `/api/docs`
- **Error Codes:** See backend error responses for specific error codes
- **WebSocket:** For real-time notifications, implement WebSocket connection (future enhancement)

---

**Last Updated:** January 2026  
**Backend Version:** Sprint 0 Complete  
**Frontend Status:** Ready for Implementation


