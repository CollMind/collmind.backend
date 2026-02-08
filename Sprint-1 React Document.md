# Sprint-1 React Document

## Table of Contents
1. [Overview](#overview)
2. [API Endpoints Documentation](#api-endpoints-documentation)
3. [Project Structure](#project-structure)
4. [Component Architecture](#component-architecture)
5. [State Management (Redux Toolkit)](#state-management-redux-toolkit)
6. [TypeScript Types & Interfaces](#typescript-types--interfaces)
7. [API Client Setup](#api-client-setup)
8. [Form Management](#form-management)
9. [UI/UX Design System](#uiux-design-system)
10. [Testing Strategy](#testing-strategy)
11. [Development Guidelines](#development-guidelines)

---

## Overview

This document provides comprehensive documentation for building a React.js frontend application that integrates with the CollMind TPM Backend API. The frontend stack is built using modern, industry-standard technologies for optimal performance, maintainability, and developer experience.

### Technology Stack Summary

- **Core Framework**: React 18.x with TypeScript 5.3+
- **Build Tool**: Vite 5.x
- **State Management**: Redux Toolkit 2.x (Global State) + TanStack Query 5.x (Server State)
- **UI Components**: Tailwind CSS 3.x + shadcn/ui + Radix UI
- **Forms**: React Hook Form 7.x + Zod 3.x
- **HTTP Client**: Axios 1.x
- **Testing**: Vitest 1.x + React Testing Library 14.x + MSW 2.x
- **Routing**: React Router 6.x

---

## API Endpoints Documentation

### Base Configuration

- **Base URL**: `http://localhost:3000` (Development)
- **Authentication**: Bearer Token (JWT)
- **Headers**: 
  - `Authorization: Bearer {accessToken}`
  - `Content-Type: application/json`
  - `x-tenant-id: {tenantId}` (Optional, auto-resolved on login)

### Authentication Endpoints

#### POST /auth/login
**Description**: Authenticate user and receive access/refresh tokens

**Request Body**:
```typescript
{
  email: string;          // Required, valid email
  password: string;       // Required, min 8 characters
  ipAddress?: string;     // Optional, client IP address
}
```

**Response** (200 OK):
```typescript
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';
    tenantId: string;
  };
}
```

**Error Responses**:
- `401 Unauthorized`: Invalid credentials

---

#### POST /auth/refresh
**Description**: Refresh access token using refresh token

**Request Body**:
```typescript
{
  refreshToken: string;
}
```

**Response** (200 OK):
```typescript
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
  };
}
```

---

#### POST /auth/logout
**Description**: Logout current user (requires authentication)

**Headers**: `Authorization: Bearer {accessToken}`

**Response**: `204 No Content`

---

### User Endpoints

All user endpoints require authentication (Bearer token).

#### GET /users
**Description**: Get all users (ADMIN, FINANCE roles only)

**Response** (200 OK):
```typescript
Array<UserResponseDto>
```

**UserResponseDto**:
```typescript
{
  id: string;
  email: string;
  role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'LOCKED';
  fullName: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  tenantId: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---

#### GET /users/me
**Description**: Get current user profile (all authenticated users)

**Response** (200 OK): `UserResponseDto`

---

#### PATCH /users/me
**Description**: Update current user profile

**Request Body**:
```typescript
{
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  // Note: password, email, role cannot be updated via this endpoint
}
```

**Response** (200 OK): `UserResponseDto`

---

#### PATCH /users/me/password
**Description**: Change current user password

**Request Body**:
```typescript
{
  currentPassword: string;
  newPassword: string;  // min 8 characters
}
```

**Response**: `204 No Content`

---

#### POST /users
**Description**: Create a new user (ADMIN only)

**Request Body**:
```typescript
{
  email: string;                    // Required, valid email
  password: string;                 // Required, min 8, max 100 characters
  fullName: string;                 // Required, min 2, max 200 characters
  firstName?: string;
  lastName?: string;
  role: 'ADMIN' | 'PLANNER' | 'APPROVER' | 'FINANCE';  // Required
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'LOCKED';
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  mustChangePassword?: boolean;
  permissions?: string[];
}
```

**Response** (201 Created): `UserResponseDto`

---

#### GET /users/:id
**Description**: Get user by ID

**Response** (200 OK): `UserResponseDto`

**Error Responses**:
- `404 Not Found`: User not found

---

#### PATCH /users/:id
**Description**: Update user (ADMIN only)

**Request Body**: Same as PATCH /users/me

**Response** (200 OK): `UserResponseDto`

---

#### PATCH /users/:id/password
**Description**: Change user password (ADMIN only)

**Request Body**:
```typescript
{
  currentPassword: string;
  newPassword: string;  // min 8 characters
}
```

**Response**: `204 No Content`

---

#### POST /users/:id/activate
**Description**: Activate user (ADMIN only)

**Response** (200 OK): `UserResponseDto`

---

#### POST /users/:id/deactivate
**Description**: Deactivate user (ADMIN only)

**Response** (200 OK): `UserResponseDto`

---

#### DELETE /users/:id
**Description**: Delete user (ADMIN only)

**Response**: `204 No Content`

---

### Customer Endpoints

All customer endpoints require authentication.

#### POST /customers
**Description**: Create a new customer (ADMIN, PLANNER roles only)

**Request Body**:
```typescript
{
  code: string;                    // Required, min 1, max 50 characters
  name: string;                    // Required, min 2, max 200 characters
  channel: 'NKA' | 'TRADITIONAL_TRADE' | 'E_COMMERCE' | 'EXPORT' | 'WHOLESALE' | 'RETAIL' | 'HORECA';  // Required
  type?: 'DIRECT' | 'DISTRIBUTOR' | 'WHOLESALER' | 'RETAILER' | 'END_CUSTOMER';
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  taxNumber?: string;
  taxOffice?: string;
  companyRegistrationNumber?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMobile?: string;
  paymentTerms?: string;
  creditLimit?: number;
  currency?: string;              // Default: 'TRY'
  salesRepresentative?: string;
  accountManager?: string;
  customerGroup?: string;
  customerSegment?: string;
  customerTier?: string;
  businessSize?: string;
  annualRevenue?: number;
  lastOrderDate?: string;         // ISO date string
  firstOrderDate?: string;        // ISO date string
  metadata?: {
    storeSize?: number;
    numberOfEmployees?: number;
    numberOfLocations?: number;
    industry?: string;
    website?: string;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
    };
  };
  notes?: string;
  isVip?: boolean;                // Default: false
  contractStartDate?: string;     // ISO date string
  contractEndDate?: string;       // ISO date string
}
```

**Response** (201 Created): `CustomerResponseDto`

---

#### POST /customers/bulk
**Description**: Create multiple customers (ADMIN, PLANNER roles only)

**Request Body**:
```typescript
{
  customers: CreateCustomerDto[];
}
```

**Response** (201 Created): `Array<CustomerResponseDto>`

---

#### GET /customers
**Description**: Get all customers with optional filters

**Query Parameters**:
```typescript
{
  channel?: 'NKA' | 'TRADITIONAL_TRADE' | 'E_COMMERCE' | 'EXPORT' | 'WHOLESALE' | 'RETAIL' | 'HORECA';
  city?: string;
  region?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';
  tier?: string;
  isVip?: boolean;
  search?: string;                // Search in name, code, contact info
  page?: number;                  // Default: 1
  limit?: number;                 // Default: 10
  sortBy?: string;                // Default: 'name'
  sortOrder?: 'ASC' | 'DESC';     // Default: 'ASC'
}
```

**Response** (200 OK): `Array<CustomerResponseDto>`

---

#### GET /customers/search
**Description**: Search customers

**Query Parameters**:
```typescript
{
  q: string;  // Search term
}
```

**Response** (200 OK): `Array<CustomerResponseDto>`

---

#### GET /customers/channel/:channel
**Description**: Get customers by channel

**Response** (200 OK): `Array<CustomerResponseDto>`

---

#### GET /customers/city/:city
**Description**: Get customers by city

**Response** (200 OK): `Array<CustomerResponseDto>`

---

#### GET /customers/vip
**Description**: Get VIP customers

**Response** (200 OK): `Array<CustomerResponseDto>`

---

#### GET /customers/:id
**Description**: Get customer by ID

**Response** (200 OK): `CustomerResponseDto`

**CustomerResponseDto**:
```typescript
{
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
  isVip: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

#### GET /customers/code/:code
**Description**: Get customer by code

**Response** (200 OK): `CustomerResponseDto`

---

#### PATCH /customers/:id
**Description**: Update customer (ADMIN, PLANNER roles only)

**Request Body**: Partial `CreateCustomerDto`

**Response** (200 OK): `CustomerResponseDto`

---

#### DELETE /customers/:id
**Description**: Delete customer (ADMIN, PLANNER roles only)

**Response**: `204 No Content`

---

#### POST /customers/:id/activate
**Description**: Activate customer (ADMIN, PLANNER roles only)

**Response** (200 OK): `CustomerResponseDto`

---

#### POST /customers/:id/deactivate
**Description**: Deactivate customer (ADMIN, PLANNER roles only)

**Response** (200 OK): `CustomerResponseDto`

---

#### GET /customers/:id/stats
**Description**: Get customer statistics

**Response** (200 OK):
```typescript
{
  // Statistics object (structure to be confirmed from backend)
}
```

---

### Tenant Endpoints

All tenant endpoints require authentication. Most require ADMIN role.

#### POST /tenants
**Description**: Create a new tenant (ADMIN only)

**Request Body**:
```typescript
{
  name: string;                    // Required, min 3, max 200 characters
  domain?: string;                 // Optional, max 100 characters
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TRIAL';
  plan?: 'FREE' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  taxNumber?: string;
  industry?: string;
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string;
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
  };
  maxUsers?: number;               // min 1
  maxStorageGB?: number;           // min 1
  subscriptionStartDate?: string;  // ISO date string
  subscriptionEndDate?: string;    // ISO date string
  notes?: string;
}
```

**Response** (201 Created): `TenantResponseDto`

**Error Responses**:
- `409 Conflict`: Tenant already exists

---

#### GET /tenants
**Description**: Get all tenants (ADMIN only)

**Response** (200 OK): `Array<TenantResponseDto>`

---

#### GET /tenants/:id
**Description**: Get tenant by ID

**Response** (200 OK): `TenantResponseDto`

**TenantResponseDto**:
```typescript
{
  id: string;
  name: string;
  domain?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TRIAL';
  plan: 'FREE' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  city?: string;
  country?: string;
  industry?: string;
  maxUsers: number;
  maxStorageGB: number;
  currentStorageGB: number;
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---

#### PATCH /tenants/:id
**Description**: Update tenant (ADMIN only)

**Request Body**: Partial `CreateTenantDto`

**Response** (200 OK): `TenantResponseDto`

---

#### DELETE /tenants/:id
**Description**: Delete tenant (ADMIN only)

**Response**: `204 No Content`

---

#### POST /tenants/:id/activate
**Description**: Activate tenant (ADMIN only)

**Response** (200 OK): `TenantResponseDto`

---

#### POST /tenants/:id/suspend
**Description**: Suspend tenant (ADMIN only)

**Response** (200 OK): `TenantResponseDto`

---

#### GET /tenants/:id/stats
**Description**: Get tenant statistics

**Response** (200 OK):
```typescript
{
  // Statistics object (structure to be confirmed from backend)
}
```

---

## Project Structure

### Recommended Directory Structure

```
collmind-frontend/
├── public/                          # Static assets
│   ├── favicon.ico
│   └── logo.svg
├── src/
│   ├── api/                         # API client and endpoints
│   │   ├── client.ts               # Axios instance configuration
│   │   ├── endpoints/
│   │   │   ├── auth.endpoints.ts
│   │   │   ├── users.endpoints.ts
│   │   │   ├── customers.endpoints.ts
│   │   │   └── tenants.endpoints.ts
│   │   └── types/                  # API response types
│   │       ├── auth.types.ts
│   │       ├── user.types.ts
│   │       ├── customer.types.ts
│   │       └── tenant.types.ts
│   ├── components/                  # Reusable UI components
│   │   ├── ui/                     # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── form.tsx
│   │   │   ├── table.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── select.tsx
│   │   │   ├── card.tsx
│   │   │   └── ...
│   │   ├── layout/                 # Layout components
│   │   │   ├── AppLayout.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── forms/                  # Form components
│   │   │   ├── LoginForm.tsx
│   │   │   ├── UserForm.tsx
│   │   │   ├── CustomerForm.tsx
│   │   │   └── TenantForm.tsx
│   │   ├── features/               # Feature-specific components
│   │   │   ├── auth/
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   └── ...
│   │   │   ├── users/
│   │   │   │   ├── UserList.tsx
│   │   │   │   ├── UserCard.tsx
│   │   │   │   ├── UserDetail.tsx
│   │   │   │   └── ...
│   │   │   ├── customers/
│   │   │   │   ├── CustomerList.tsx
│   │   │   │   ├── CustomerCard.tsx
│   │   │   │   ├── CustomerDetail.tsx
│   │   │   │   ├── CustomerFilters.tsx
│   │   │   │   └── ...
│   │   │   └── tenants/
│   │   │       ├── TenantList.tsx
│   │   │       ├── TenantCard.tsx
│   │   │       └── ...
│   │   └── common/                 # Common components
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── EmptyState.tsx
│   │       ├── ConfirmDialog.tsx
│   │       └── ...
│   ├── store/                      # Redux store configuration
│   │   ├── index.ts
│   │   ├── hooks.ts                # Typed hooks (useAppDispatch, useAppSelector)
│   │   └── slices/
│   │       ├── auth.slice.ts
│   │       ├── ui.slice.ts
│   │       └── ...
│   ├── services/                   # TanStack Query services
│   │   ├── auth.service.ts
│   │   ├── users.service.ts
│   │   ├── customers.service.ts
│   │   └── tenants.service.ts
│   ├── hooks/                      # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── usePermissions.ts
│   │   └── ...
│   ├── utils/                      # Utility functions
│   │   ├── constants.ts
│   │   ├── helpers.ts
│   │   ├── formatters.ts
│   │   └── validators.ts
│   ├── lib/                        # Third-party library configurations
│   │   ├── react-query.ts          # TanStack Query setup
│   │   └── ...
│   ├── types/                      # TypeScript types and interfaces
│   │   ├── index.ts
│   │   ├── user.types.ts
│   │   ├── customer.types.ts
│   │   ├── tenant.types.ts
│   │   └── common.types.ts
│   ├── schemas/                    # Zod validation schemas
│   │   ├── auth.schema.ts
│   │   ├── user.schema.ts
│   │   ├── customer.schema.ts
│   │   └── tenant.schema.ts
│   ├── routes/                     # Route configuration
│   │   └── index.tsx
│   ├── App.tsx                     # Root component
│   ├── main.tsx                    # Entry point
│   └── vite-env.d.ts
├── tests/                          # Test files
│   ├── setup.ts                    # Test setup
│   ├── mocks/                      # Mock data and handlers
│   │   ├── handlers.ts             # MSW handlers
│   │   └── data/
│   ├── utils/                      # Test utilities
│   │   └── test-utils.tsx          # Custom render function
│   └── components/                 # Component tests
│       ├── LoginForm.test.tsx
│       ├── UserList.test.tsx
│       └── ...
├── .env                            # Environment variables
├── .env.example
├── .eslintrc.cjs                   # ESLint configuration
├── .prettierrc                     # Prettier configuration
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── vitest.config.ts
```

---

## Component Architecture

### Component Hierarchy Pattern

```
App
└── Router
    ├── AuthLayout (for login/register)
    │   └── LoginPage
    └── AppLayout (for authenticated routes)
        ├── Header
        ├── Sidebar
        ├── Main Content Area
        │   ├── UsersModule
        │   │   ├── UserList
        │   │   ├── UserDetail
        │   │   └── UserForm
        │   ├── CustomersModule
        │   │   ├── CustomerList
        │   │   ├── CustomerFilters
        │   │   ├── CustomerDetail
        │   │   └── CustomerForm
        │   └── TenantsModule
        │       ├── TenantList
        │       ├── TenantDetail
        │       └── TenantForm
        └── Footer
```

### Component Categories

#### 1. Layout Components
- **AppLayout**: Main application layout with header, sidebar, and content area
- **AuthLayout**: Minimal layout for authentication pages
- **ProtectedRoute**: Route wrapper that checks authentication and permissions

#### 2. UI Components (shadcn/ui)
- Reusable, accessible components built on Radix UI
- Examples: Button, Input, Form, Table, Dialog, Select, Card, Badge, etc.

#### 3. Feature Components
- Domain-specific components organized by feature
- Examples: UserList, CustomerForm, TenantCard

#### 4. Form Components
- Form components using React Hook Form + Zod
- Reusable form fields and validation logic

#### 5. Common Components
- Shared utility components
- Examples: LoadingSpinner, ErrorBoundary, EmptyState, ConfirmDialog

### Component Structure Example

```typescript
// components/features/customers/CustomerList.tsx
import { useQuery } from '@tanstack/react-query';
import { CustomerCard } from './CustomerCard';
import { CustomerFilters } from './CustomerFilters';
import { useCustomers } from '@/services/customers.service';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';

export function CustomerList() {
  const { data: customers, isLoading, error } = useCustomers();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} />;
  if (!customers?.length) return <EmptyState message="No customers found" />;

  return (
    <div className="space-y-4">
      <CustomerFilters />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} />
        ))}
      </div>
    </div>
  );
}
```

---

## State Management (Redux Toolkit)

### Store Structure

```typescript
// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/auth.slice';
import uiReducer from './slices/ui.slice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// store/hooks.ts
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './index';

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

### Auth Slice Example

```typescript
// store/slices/auth.slice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@/types/user.types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: false,
  isLoading: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{
        user: User;
        accessToken: string;
        refreshToken: string;
      }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.isAuthenticated = true;
      localStorage.setItem('accessToken', action.payload.accessToken);
      localStorage.setItem('refreshToken', action.payload.refreshToken);
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const { setCredentials, logout, setLoading } = authSlice.actions;
export default authSlice.reducer;
```

### UI Slice Example

```typescript
// store/slices/ui.slice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UiState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'auto';
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    timestamp: number;
  }>;
}

const initialState: UiState = {
  sidebarOpen: true,
  theme: 'light',
  notifications: [],
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'auto'>) => {
      state.theme = action.payload;
    },
    addNotification: (
      state,
      action: PayloadAction<{
        type: 'success' | 'error' | 'warning' | 'info';
        message: string;
      }>
    ) => {
      state.notifications.push({
        id: Date.now().toString(),
        ...action.payload,
        timestamp: Date.now(),
      });
    },
    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(
        (n) => n.id !== action.payload
      );
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setTheme,
  addNotification,
  removeNotification,
} = uiSlice.actions;
export default uiSlice.reducer;
```

---

## TypeScript Types & Interfaces

### Type Definitions

```typescript
// types/user.types.ts
export enum UserRole {
  ADMIN = 'ADMIN',
  PLANNER = 'PLANNER',
  APPROVER = 'APPROVER',
  FINANCE = 'FINANCE',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  LOCKED = 'LOCKED',
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  tenantId: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDto {
  email: string;
  password: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  status?: UserStatus;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
  mustChangePassword?: boolean;
  permissions?: string[];
}

export interface UpdateUserDto {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  department?: string;
  jobTitle?: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

// types/customer.types.ts
export enum CustomerChannel {
  NKA = 'NKA',
  TRADITIONAL_TRADE = 'TRADITIONAL_TRADE',
  E_COMMERCE = 'E_COMMERCE',
  EXPORT = 'EXPORT',
  WHOLESALE = 'WHOLESALE',
  RETAIL = 'RETAIL',
  HORECA = 'HORECA',
}

export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
}

export enum CustomerType {
  DIRECT = 'DIRECT',
  DISTRIBUTOR = 'DISTRIBUTOR',
  WHOLESALER = 'WHOLESALER',
  RETAILER = 'RETAILER',
  END_CUSTOMER = 'END_CUSTOMER',
}

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
  isVip: boolean;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerDto {
  code: string;
  name: string;
  channel: CustomerChannel;
  type?: CustomerType;
  status?: CustomerStatus;
  city?: string;
  district?: string;
  region?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  taxNumber?: string;
  taxOffice?: string;
  companyRegistrationNumber?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMobile?: string;
  paymentTerms?: string;
  creditLimit?: number;
  currency?: string;
  salesRepresentative?: string;
  accountManager?: string;
  customerGroup?: string;
  customerSegment?: string;
  customerTier?: string;
  businessSize?: string;
  annualRevenue?: number;
  lastOrderDate?: string;
  firstOrderDate?: string;
  metadata?: {
    storeSize?: number;
    numberOfEmployees?: number;
    numberOfLocations?: number;
    industry?: string;
    website?: string;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
    };
  };
  notes?: string;
  isVip?: boolean;
  contractStartDate?: string;
  contractEndDate?: string;
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}

export interface CustomerFilterDto {
  channel?: CustomerChannel;
  city?: string;
  region?: string;
  status?: CustomerStatus;
  tier?: string;
  isVip?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

// types/tenant.types.ts
export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRIAL = 'TRIAL',
}

export enum TenantPlan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export interface Tenant {
  id: string;
  name: string;
  domain?: string;
  status: TenantStatus;
  plan: TenantPlan;
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  city?: string;
  country?: string;
  industry?: string;
  maxUsers: number;
  maxStorageGB: number;
  currentStorageGB: number;
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantDto {
  name: string;
  domain?: string;
  status?: TenantStatus;
  plan?: TenantPlan;
  contactEmail?: string;
  contactPhone?: string;
  contactPerson?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  taxNumber?: string;
  industry?: string;
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string;
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
  };
  maxUsers?: number;
  maxStorageGB?: number;
  subscriptionStartDate?: string;
  subscriptionEndDate?: string;
  notes?: string;
}

export interface UpdateTenantDto extends Partial<CreateTenantDto> {}

// types/auth.types.ts
export interface LoginDto {
  email: string;
  password: string;
  ipAddress?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    tenantId: string;
  };
}

// types/common.types.ts
export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## API Client Setup

### Axios Configuration

```typescript
// api/client.ts
import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { store } from '@/store';
import { logout } from '@/store/slices/auth.slice';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = store.getState().auth.accessToken;
    const tenantId = store.getState().auth.user?.tenantId;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (tenantId) {
      config.headers['x-tenant-id'] = tenantId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - Handle token refresh and errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = store.getState().auth.refreshToken;
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        store.dispatch(
          setCredentials({
            user: store.getState().auth.user!,
            accessToken,
            refreshToken: newRefreshToken,
          })
        );

        // Retry original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout user
        store.dispatch(logout());
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
```

### API Endpoints

```typescript
// api/endpoints/auth.endpoints.ts
import apiClient from '../client';
import { LoginDto, LoginResponse } from '@/types/auth.types';

export const authEndpoints = {
  login: (data: LoginDto) =>
    apiClient.post<LoginResponse>('/auth/login', data),
  
  refresh: (refreshToken: string) =>
    apiClient.post<LoginResponse>('/auth/refresh', { refreshToken }),
  
  logout: () => apiClient.post('/auth/logout'),
};

// api/endpoints/users.endpoints.ts
import apiClient from '../client';
import { User, CreateUserDto, UpdateUserDto, ChangePasswordDto } from '@/types/user.types';

export const userEndpoints = {
  getAll: () => apiClient.get<User[]>('/users'),
  
  getById: (id: string) => apiClient.get<User>(`/users/${id}`),
  
  getMe: () => apiClient.get<User>('/users/me'),
  
  create: (data: CreateUserDto) => apiClient.post<User>('/users', data),
  
  update: (id: string, data: UpdateUserDto) =>
    apiClient.patch<User>(`/users/${id}`, data),
  
  updateMe: (data: UpdateUserDto) => apiClient.patch<User>('/users/me', data),
  
  changePassword: (id: string, data: ChangePasswordDto) =>
    apiClient.patch(`/users/${id}/password`, data),
  
  changeMyPassword: (data: ChangePasswordDto) =>
    apiClient.patch('/users/me/password', data),
  
  activate: (id: string) => apiClient.post<User>(`/users/${id}/activate`),
  
  deactivate: (id: string) => apiClient.post<User>(`/users/${id}/deactivate`),
  
  delete: (id: string) => apiClient.delete(`/users/${id}`),
};

// api/endpoints/customers.endpoints.ts
import apiClient from '../client';
import {
  Customer,
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerFilterDto,
} from '@/types/customer.types';

export const customerEndpoints = {
  getAll: (filters?: CustomerFilterDto) =>
    apiClient.get<Customer[]>('/customers', { params: filters }),
  
  getById: (id: string) => apiClient.get<Customer>(`/customers/${id}`),
  
  getByCode: (code: string) => apiClient.get<Customer>(`/customers/code/${code}`),
  
  search: (query: string) =>
    apiClient.get<Customer[]>('/customers/search', { params: { q: query } }),
  
  getByChannel: (channel: string) =>
    apiClient.get<Customer[]>(`/customers/channel/${channel}`),
  
  getByCity: (city: string) =>
    apiClient.get<Customer[]>(`/customers/city/${city}`),
  
  getVip: () => apiClient.get<Customer[]>('/customers/vip'),
  
  create: (data: CreateCustomerDto) =>
    apiClient.post<Customer>('/customers', data),
  
  createBulk: (customers: CreateCustomerDto[]) =>
    apiClient.post<Customer[]>('/customers/bulk', { customers }),
  
  update: (id: string, data: UpdateCustomerDto) =>
    apiClient.patch<Customer>(`/customers/${id}`, data),
  
  delete: (id: string) => apiClient.delete(`/customers/${id}`),
  
  activate: (id: string) => apiClient.post<Customer>(`/customers/${id}/activate`),
  
  deactivate: (id: string) => apiClient.post<Customer>(`/customers/${id}/deactivate`),
  
  getStats: (id: string) => apiClient.get(`/customers/${id}/stats`),
};

// api/endpoints/tenants.endpoints.ts
import apiClient from '../client';
import { Tenant, CreateTenantDto, UpdateTenantDto } from '@/types/tenant.types';

export const tenantEndpoints = {
  getAll: () => apiClient.get<Tenant[]>('/tenants'),
  
  getById: (id: string) => apiClient.get<Tenant>(`/tenants/${id}`),
  
  create: (data: CreateTenantDto) => apiClient.post<Tenant>('/tenants', data),
  
  update: (id: string, data: UpdateTenantDto) =>
    apiClient.patch<Tenant>(`/tenants/${id}`, data),
  
  delete: (id: string) => apiClient.delete(`/tenants/${id}`),
  
  activate: (id: string) => apiClient.post<Tenant>(`/tenants/${id}/activate`),
  
  suspend: (id: string) => apiClient.post<Tenant>(`/tenants/${id}/suspend`),
  
  getStats: (id: string) => apiClient.get(`/tenants/${id}/stats`),
};
```

### TanStack Query Services

```typescript
// services/auth.service.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authEndpoints } from '@/api/endpoints/auth.endpoints';
import { LoginDto } from '@/types/auth.types';
import { setCredentials, logout } from '@/store/slices/auth.slice';
import { useAppDispatch } from '@/store/hooks';
import { useNavigate } from 'react-router-dom';

export function useLogin() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LoginDto) => authEndpoints.login(data).then((res) => res.data),
    onSuccess: (data) => {
      dispatch(
        setCredentials({
          user: data.user as any,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        })
      );
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      navigate('/dashboard');
    },
  });
}

export function useRefreshToken() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (refreshToken: string) =>
      authEndpoints.refresh(refreshToken).then((res) => res.data),
    onSuccess: (data) => {
      dispatch(
        setCredentials({
          user: data.user as any,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        })
      );
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
    },
  });
}

export function useLogout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => authEndpoints.logout().then((res) => res.data),
    onSuccess: () => {
      dispatch(logout());
      navigate('/login');
    },
  });
}

// services/users.service.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userEndpoints } from '@/api/endpoints/users.endpoints';
import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from '@/types/user.types';

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters?: any) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  me: () => [...userKeys.all, 'me'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.lists(),
    queryFn: () => userEndpoints.getAll().then((res) => res.data),
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => userEndpoints.getById(id).then((res) => res.data),
    enabled: !!id,
  });
}

export function useMe() {
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: () => userEndpoints.getMe().then((res) => res.data),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserDto) =>
      userEndpoints.create(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserDto }) =>
      userEndpoints.update(id, data).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateUserDto) =>
      userEndpoints.updateMe(data).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: userKeys.me() });
      queryClient.invalidateQueries({ queryKey: userKeys.detail(data.id) });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ChangePasswordDto }) =>
      userEndpoints.changePassword(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useChangeMyPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ChangePasswordDto) =>
      userEndpoints.changeMyPassword(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.me() });
    },
  });
}

export function useActivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      userEndpoints.activate(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      userEndpoints.deactivate(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => userEndpoints.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

// services/customers.service.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerEndpoints } from '@/api/endpoints/customers.endpoints';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerFilterDto,
} from '@/types/customer.types';

export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (filters?: CustomerFilterDto) => [...customerKeys.lists(), filters] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  search: (query: string) => [...customerKeys.all, 'search', query] as const,
  byChannel: (channel: string) => [...customerKeys.all, 'channel', channel] as const,
  byCity: (city: string) => [...customerKeys.all, 'city', city] as const,
  vip: () => [...customerKeys.all, 'vip'] as const,
};

export function useCustomers(filters?: CustomerFilterDto) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: () => customerEndpoints.getAll(filters).then((res) => res.data),
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => customerEndpoints.getById(id).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCustomerDto) =>
      customerEndpoints.create(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomerDto }) =>
      customerEndpoints.update(id, data).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useSearchCustomers(query: string) {
  return useQuery({
    queryKey: customerKeys.search(query),
    queryFn: () => customerEndpoints.search(query).then((res) => res.data),
    enabled: !!query && query.length > 0,
  });
}

export function useCustomerByCode(code: string) {
  return useQuery({
    queryKey: [...customerKeys.details(), 'code', code],
    queryFn: () => customerEndpoints.getByCode(code).then((res) => res.data),
    enabled: !!code,
  });
}

export function useCustomersByChannel(channel: string) {
  return useQuery({
    queryKey: customerKeys.byChannel(channel),
    queryFn: () => customerEndpoints.getByChannel(channel).then((res) => res.data),
    enabled: !!channel,
  });
}

export function useCustomersByCity(city: string) {
  return useQuery({
    queryKey: customerKeys.byCity(city),
    queryFn: () => customerEndpoints.getByCity(city).then((res) => res.data),
    enabled: !!city,
  });
}

export function useVipCustomers() {
  return useQuery({
    queryKey: customerKeys.vip(),
    queryFn: () => customerEndpoints.getVip().then((res) => res.data),
  });
}

export function useCreateBulkCustomers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (customers: CreateCustomerDto[]) =>
      customerEndpoints.createBulk(customers).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useActivateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      customerEndpoints.activate(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useDeactivateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      customerEndpoints.deactivate(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useCustomerStats(id: string) {
  return useQuery({
    queryKey: [...customerKeys.detail(id), 'stats'],
    queryFn: () => customerEndpoints.getStats(id).then((res) => res.data),
    enabled: !!id,
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => customerEndpoints.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

// services/tenants.service.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantEndpoints } from '@/api/endpoints/tenants.endpoints';
import { CreateTenantDto, UpdateTenantDto } from '@/types/tenant.types';

export const tenantKeys = {
  all: ['tenants'] as const,
  lists: () => [...tenantKeys.all, 'list'] as const,
  list: (filters?: any) => [...tenantKeys.lists(), filters] as const,
  details: () => [...tenantKeys.all, 'detail'] as const,
  detail: (id: string) => [...tenantKeys.details(), id] as const,
  stats: (id: string) => [...tenantKeys.detail(id), 'stats'] as const,
};

export function useTenants() {
  return useQuery({
    queryKey: tenantKeys.lists(),
    queryFn: () => tenantEndpoints.getAll().then((res) => res.data),
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: tenantKeys.detail(id),
    queryFn: () => tenantEndpoints.getById(id).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTenantDto) =>
      tenantEndpoints.create(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.lists() });
    },
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTenantDto }) =>
      tenantEndpoints.update(id, data).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: tenantKeys.lists() });
    },
  });
}

export function useActivateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      tenantEndpoints.activate(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: tenantKeys.lists() });
    },
  });
}

export function useSuspendTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      tenantEndpoints.suspend(id).then((res) => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: tenantKeys.lists() });
    },
  });
}

export function useTenantStats(id: string) {
  return useQuery({
    queryKey: tenantKeys.stats(id),
    queryFn: () => tenantEndpoints.getStats(id).then((res) => res.data),
    enabled: !!id,
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tenantEndpoints.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.lists() });
    },
  });
}
```

---

## Form Management

### Zod Schemas

```typescript
// schemas/auth.schema.ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  ipAddress: z.string().ip().optional(),
});

export type LoginFormData = z.infer<typeof loginSchema>;

// schemas/user.schema.ts
import { z } from 'zod';
import { UserRole, UserStatus } from '@/types/user.types';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(200),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.nativeEnum(UserRole),
  status: z.nativeEnum(UserStatus).optional(),
  phoneNumber: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  mustChangePassword: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phoneNumber: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export type CreateUserFormData = z.infer<typeof createUserSchema>;
export type UpdateUserFormData = z.infer<typeof updateUserSchema>;
export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

// schemas/customer.schema.ts
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
  city: z.string().optional(),
  district: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  taxNumber: z.string().optional(),
  taxOffice: z.string().optional(),
  companyRegistrationNumber: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  contactMobile: z.string().optional(),
  paymentTerms: z.string().optional(),
  creditLimit: z.number().positive().optional(),
  currency: z.string().optional(),
  salesRepresentative: z.string().optional(),
  accountManager: z.string().optional(),
  customerGroup: z.string().optional(),
  customerSegment: z.string().optional(),
  customerTier: z.string().optional(),
  businessSize: z.string().optional(),
  annualRevenue: z.number().positive().optional(),
  lastOrderDate: z.string().optional(),
  firstOrderDate: z.string().optional(),
  metadata: z
    .object({
      storeSize: z.number().optional(),
      numberOfEmployees: z.number().optional(),
      numberOfLocations: z.number().optional(),
      industry: z.string().optional(),
      website: z.string().url().optional(),
      socialMedia: z
        .object({
          facebook: z.string().url().optional(),
          instagram: z.string().url().optional(),
          linkedin: z.string().url().optional(),
        })
        .optional(),
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

### Form Component Example

```typescript
// components/forms/CustomerForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  createCustomerSchema,
  CreateCustomerFormData,
} from '@/schemas/customer.schema';
import { useCreateCustomer, useUpdateCustomer } from '@/services/customers.service';
import { CustomerChannel, CustomerType, CustomerStatus } from '@/types/customer.types';
import { Customer } from '@/types/customer.types';

interface CustomerFormProps {
  customer?: Customer;
  onSuccess?: () => void;
  onCancel?: () => void;
}

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
          city: customer.city,
          // ... other fields
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
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="channel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Channel</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <select>
                    {Object.values(CustomerChannel).map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                </FormControl>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Add more fields as needed */}

        <div className="flex justify-end space-x-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            {customer ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

---

## UI/UX Design System

### Design Principles

The UI/UX design follows modern, clean, and user-friendly principles:

- **Consistency**: Unified design language across all components
- **Responsiveness**: Mobile-first approach with seamless desktop experience
- **Accessibility**: WCAG 2.1 AA compliant components
- **Performance**: Optimized animations and transitions (60fps target)
- **User-Centric**: Intuitive navigation and clear visual hierarchy

### Responsive Breakpoints

Using Tailwind CSS default breakpoints with custom adjustments:

```typescript
// tailwind.config.js
export default {
  theme: {
    extend: {
      screens: {
        'xs': '475px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      },
    },
  },
};
```

**Breakpoint Strategy**:
- **Mobile (xs-sm)**: Single column layout, collapsible sidebar
- **Tablet (md-lg)**: Two-column layouts, expandable sidebar
- **Desktop (xl-2xl)**: Multi-column layouts, persistent sidebar

### Color System

Modern color palette with dark mode support:

```typescript
// tailwind.config.js - Color Theme
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9', // Main brand color
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          600: '#16a34a',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          600: '#d97706',
        },
        error: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
    },
  },
};
```

### Typography System

```typescript
// tailwind.config.js - Typography
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
    },
  },
};
```

### Spacing & Layout System

Consistent spacing scale using 4px base unit:

```typescript
// Standard spacing values (multiples of 4px)
spacing: {
  '0': '0px',
  '1': '0.25rem',   // 4px
  '2': '0.5rem',    // 8px
  '3': '0.75rem',   // 12px
  '4': '1rem',      // 16px
  '5': '1.25rem',   // 20px
  '6': '1.5rem',    // 24px
  '8': '2rem',      // 32px
  '10': '2.5rem',   // 40px
  '12': '3rem',     // 48px
  '16': '4rem',     // 64px
  '20': '5rem',     // 80px
  '24': '6rem',     // 96px
}
```

### Shadow System

Elevation-based shadow system:

```typescript
boxShadow: {
  'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  'md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  'inner': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
}
```

---

## Authentication Pages Design

### Login/Register Page - Split Screen Layout

Modern split-screen authentication design with full-height layout.

#### Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Full Height Container                │
│                                                         │
│  ┌──────────────┐  ┌────────────────────────────────┐  │
│  │              │  │                                │  │
│  │  Left Grid   │  │      Right Grid (Banner)       │  │
│  │  (50% width) │  │      (50% width)               │  │
│  │              │  │                                │  │
│  │  - Login     │  │  - Hero Image/Illustration     │  │
│  │  - Register  │  │  - Branding Elements           │  │
│  │  - Forms     │  │  - Feature Highlights          │  │
│  │              │  │  - Testimonials/Stats          │  │
│  │              │  │                                │  │
│  └──────────────┘  └────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Component Implementation

```typescript
// components/features/auth/AuthLayout.tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';

type AuthView = 'login' | 'register' | 'forgot-password';

export function AuthLayout() {
  const [currentView, setCurrentView] = useState<AuthView>('login');

  return (
    <div className="min-h-screen flex">
      {/* Left Grid - Forms */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-4 sm:px-6 lg:px-12 xl:px-20 bg-white dark:bg-gray-900">
        <div className="max-w-md w-full mx-auto">
          {/* Logo/Brand */}
          <div className="mb-8">
            <img
              src="/logo.svg"
              alt="CollMind TPM"
              className="h-8 w-auto mb-4"
            />
            <h1 className="text-3xl font-display font-bold text-gray-900 dark:text-white">
              {currentView === 'login' && 'Welcome Back'}
              {currentView === 'register' && 'Get Started'}
              {currentView === 'forgot-password' && 'Reset Password'}
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {currentView === 'login' && 'Sign in to your account to continue'}
              {currentView === 'register' && 'Create your account to get started'}
              {currentView === 'forgot-password' && 'Enter your email to reset your password'}
            </p>
          </div>

          {/* Form Container with Animation */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              {currentView === 'login' && (
                <LoginForm
                  onSwitchToRegister={() => setCurrentView('register')}
                  onSwitchToForgotPassword={() => setCurrentView('forgot-password')}
                />
              )}
              {currentView === 'register' && (
                <RegisterForm
                  onSwitchToLogin={() => setCurrentView('login')}
                />
              )}
              {currentView === 'forgot-password' && (
                <ForgotPasswordForm
                  onSwitchToLogin={() => setCurrentView('login')}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Footer Links */}
          <div className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400">
            <p>
              By continuing, you agree to our{' '}
              <a href="/terms" className="text-primary-600 hover:text-primary-700 font-medium">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-primary-600 hover:text-primary-700 font-medium">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Right Grid - Banner/Visual */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 text-white">
          {/* Hero Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl xl:text-5xl font-display font-bold mb-6">
              Transform Your Trade Promotion Management
            </h2>
            <p className="text-xl xl:text-2xl mb-8 text-primary-100 leading-relaxed">
              Streamline operations, boost efficiency, and make data-driven decisions with our comprehensive TPM platform.
            </p>

            {/* Feature Highlights */}
            <div className="space-y-6 mb-12">
              {[
                {
                  icon: '📊',
                  title: 'Advanced Analytics',
                  description: 'Real-time insights and comprehensive reporting',
                },
                {
                  icon: '🚀',
                  title: 'Automated Workflows',
                  description: 'Reduce manual tasks and increase productivity',
                },
                {
                  icon: '🔒',
                  title: 'Enterprise Security',
                  description: 'Bank-level encryption and compliance standards',
                },
              ].map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 + 0.3 }}
                  className="flex items-start space-x-4"
                >
                  <div className="text-3xl">{feature.icon}</div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">{feature.title}</h3>
                    <p className="text-primary-100">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Stats or Testimonials */}
            <div className="grid grid-cols-3 gap-8 pt-8 border-t border-white/20">
              <div>
                <div className="text-3xl font-bold mb-1">10K+</div>
                <div className="text-sm text-primary-100">Active Users</div>
              </div>
              <div>
                <div className="text-3xl font-bold mb-1">99.9%</div>
                <div className="text-sm text-primary-100">Uptime</div>
              </div>
              <div>
                <div className="text-3xl font-bold mb-1">24/7</div>
                <div className="text-sm text-primary-100">Support</div>
              </div>
            </div>
          </motion.div>

          {/* Decorative Elements */}
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl" />
          <div className="absolute top-0 left-0 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>
    </div>
  );
}
```

#### Login Form Component

```typescript
// components/features/auth/LoginForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { loginSchema, LoginFormData } from '@/schemas/auth.schema';
import { useLogin } from '@/services/auth.service';
import { AlertCircle, Mail, Lock, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToForgotPassword: () => void;
}

export function LoginForm({ onSwitchToRegister, onSwitchToForgotPassword }: LoginFormProps) {
  const loginMutation = useLogin();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      await loginMutation.mutateAsync(data);
    } catch (error) {
      // Error handling is done by mutation
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Error Alert */}
        {loginMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Invalid email or password. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Email Field */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    {...field}
                    type="email"
                    placeholder="you@example.com"
                    className="pl-10 h-12"
                    disabled={loginMutation.isPending}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password Field */}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <button
                  type="button"
                  onClick={onSwitchToForgotPassword}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <FormControl>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    {...field}
                    type="password"
                    placeholder="Enter your password"
                    className="pl-10 h-12"
                    disabled={loginMutation.isPending}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Remember Me */}
        <div className="flex items-center space-x-2">
          <Checkbox id="remember" />
          <label
            htmlFor="remember"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Remember me for 30 days
          </label>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          className="w-full h-12 text-base font-semibold"
          disabled={loginMutation.isPending}
        >
          {loginMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </Button>

        {/* Register Link */}
        <div className="text-center text-sm">
          <span className="text-gray-600 dark:text-gray-400">Don't have an account? </span>
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-primary-600 hover:text-primary-700 font-semibold"
          >
            Sign up
          </button>
        </div>
      </form>
    </Form>
  );
}
```

#### Responsive Behavior

```typescript
// Mobile: Single column, banner hidden
<div className="lg:hidden">
  {/* Mobile login form only */}
</div>

// Tablet/Desktop: Split screen
<div className="hidden lg:flex">
  {/* Split screen layout */}
</div>
```

**Responsive Breakpoints**:
- **Mobile (< 1024px)**: Full-width form, banner hidden
- **Desktop (≥ 1024px)**: Split 50/50 layout, both grids visible

---

## Main Application Layout

### Header Component

Modern, responsive header with user menu and navigation.

```typescript
// components/layout/Header.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Search,
  Menu,
  User,
  Settings,
  LogOut,
  ChevronDown,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { toggleSidebar, setTheme } from '@/store/slices/ui.slice';
import { logout } from '@/store/slices/auth.slice';
import { useMe } from '@/services/users.service';
import { cn } from '@/lib/utils';

export function Header() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const sidebarOpen = useAppSelector((state) => state.ui.sidebarOpen);
  const theme = useAppSelector((state) => state.ui.theme);
  const { data: user } = useMe();

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const toggleTheme = () => {
    dispatch(setTheme(theme === 'light' ? 'dark' : 'light'));
  };

  const userInitials = user?.fullName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 dark:bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-gray-900/60">
      <div className="flex h-16 items-center px-4 lg:px-6">
        {/* Mobile Menu Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden mr-2"
          onClick={() => dispatch(toggleSidebar())}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Logo */}
        <Link to="/dashboard" className="flex items-center space-x-2 mr-6">
          <img src="/logo.svg" alt="CollMind" className="h-8 w-auto" />
          <span className="hidden sm:inline-block font-display font-bold text-xl">
            CollMind TPM
          </span>
        </Link>

        {/* Search Bar (Desktop) */}
        <div className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="search"
              placeholder="Search customers, users, or anything..."
              className="pl-10 h-9"
            />
          </div>
        </div>

        {/* Right Side Actions */}
        <div className="flex items-center space-x-2 ml-auto">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="hidden sm:flex"
          >
            {theme === 'light' ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
          </Button>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  3
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-96 overflow-y-auto">
                {/* Notification items */}
                <DropdownMenuItem className="flex flex-col items-start p-4 cursor-pointer">
                  <div className="font-medium">New customer added</div>
                  <div className="text-sm text-gray-500">2 minutes ago</div>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center space-x-2 h-auto py-2 px-3"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.avatarUrl} alt={user?.fullName} />
                  <AvatarFallback className="bg-primary-500 text-white">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <div className="text-sm font-medium">{user?.fullName}</div>
                  <div className="text-xs text-gray-500">{user?.role}</div>
                </div>
                <ChevronDown className="hidden md:block h-4 w-4 text-gray-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.fullName}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile" className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
```

### Sidebar Component

Modern, collapsible sidebar with navigation groups.

```typescript
// components/layout/Sidebar.tsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Building2,
  Settings,
  ChevronLeft,
  ChevronRight,
  FileText,
  BarChart3,
  Calendar,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setSidebarOpen } from '@/store/slices/ui.slice';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMe } from '@/services/users.service';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  children?: NavItem[];
  roles?: string[];
}

const navigation: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Customers',
    href: '/customers',
    icon: UsersRound,
    badge: 'New',
  },
  {
    title: 'Users',
    href: '/users',
    icon: Users,
    roles: ['ADMIN'],
  },
  {
    title: 'Tenants',
    href: '/tenants',
    icon: Building2,
    roles: ['ADMIN'],
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: FileText,
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
  },
  {
    title: 'Calendar',
    href: '/calendar',
    icon: Calendar,
  },
  {
    title: 'Products',
    href: '/products',
    icon: Package,
  },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const sidebarOpen = useAppSelector((state) => state.ui.sidebarOpen);
  const { data: user } = useMe();

  const filteredNavigation = navigation.filter(
    (item) => !item.roles || (user?.role && item.roles.includes(user.role))
  );

  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(`${href}/`);

  const SidebarContent = () => (
    <ScrollArea className="flex-1 px-3 py-4">
      <nav className="space-y-1">
        {filteredNavigation.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <TooltipProvider key={item.href} delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    className={cn(
                      'group flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      'hover:bg-gray-100 dark:hover:bg-gray-800',
                      active
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                        : 'text-gray-700 dark:text-gray-300'
                    )}
                  >
                    <Icon
                      className={cn(
                        'mr-3 h-5 w-5 flex-shrink-0 transition-colors',
                        active
                          ? 'text-primary-600 dark:text-primary-400'
                          : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                      )}
                    />
                    <span className={cn('flex-1', !sidebarOpen && 'sr-only')}>
                      {item.title}
                    </span>
                    {item.badge && sidebarOpen && (
                      <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                {!sidebarOpen && (
                  <TooltipContent side="right" className="ml-2">
                    {item.title}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </nav>

      <Separator className="my-4" />

      {/* Settings Section */}
      <nav className="space-y-1">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                className={cn(
                  'group flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  'hover:bg-gray-100 dark:hover:bg-gray-800',
                  isActive('/settings')
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                    : 'text-gray-700 dark:text-gray-300'
                )}
              >
                <Settings
                  className={cn(
                    'mr-3 h-5 w-5 flex-shrink-0 transition-colors',
                    isActive('/settings')
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                  )}
                />
                <span className={cn('flex-1', !sidebarOpen && 'sr-only')}>
                  Settings
                </span>
              </Link>
            </TooltipTrigger>
            {!sidebarOpen && (
              <TooltipContent side="right" className="ml-2">
                Settings
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </nav>
    </ScrollArea>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:top-16 lg:w-64 lg:z-40',
          'bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800',
          'transition-all duration-300 ease-in-out'
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className={cn(
            'text-lg font-semibold text-gray-900 dark:text-white transition-opacity',
            !sidebarOpen && 'opacity-0'
          )}>
            Navigation
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => dispatch(setSidebarOpen(!sidebarOpen))}
            className="h-8 w-8"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Sidebar Content */}
        <div className={cn(
          'flex-1 overflow-hidden transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-16'
        )}>
          {sidebarOpen ? (
            <SidebarContent />
          ) : (
            <div className="px-2 py-4">
              <nav className="space-y-1">
                {filteredNavigation.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                    <TooltipProvider key={item.href} delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.href}
                            className={cn(
                              'flex items-center justify-center rounded-lg p-2.5',
                              'hover:bg-gray-100 dark:hover:bg-gray-800',
                              active
                                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20'
                                : 'text-gray-700 dark:text-gray-300'
                            )}
                          >
                            <Icon className="h-5 w-5" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="ml-2">
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </nav>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => dispatch(setSidebarOpen(false))}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            />
            {/* Sidebar */}
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 lg:hidden"
            >
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-800">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Navigation
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => dispatch(setSidebarOpen(false))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
                <SidebarContent />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
```

### App Layout Wrapper

```typescript
// components/layout/AppLayout.tsx
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useAppSelector } from '@/store/hooks';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const sidebarOpen = useAppSelector((state) => state.ui.sidebarOpen);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="flex">
        <Sidebar />
        <main
          className={cn(
            'flex-1 transition-all duration-300',
            'lg:ml-64', // Sidebar width when open
            sidebarOpen ? 'lg:ml-64' : 'lg:ml-16'
          )}
        >
          <div className="container mx-auto px-4 py-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
```

---

## Utility Functions

### Class Name Utility (cn)

The `cn` function is used for conditionally joining class names:

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

This utility combines `clsx` for conditional classes and `tailwind-merge` to resolve Tailwind class conflicts.

---

## Responsive Design Guidelines

### Mobile-First Approach

All components should be designed mobile-first:

1. **Base Styles**: Mobile (default, no breakpoint)
2. **Tablet Styles**: `md:` prefix (768px+)
3. **Desktop Styles**: `lg:` prefix (1024px+)
4. **Large Desktop**: `xl:` prefix (1280px+)

### Breakpoint Usage Examples

```typescript
// Mobile: Stack vertically
<div className="flex flex-col space-y-4">
  {/* Mobile layout */}
</div>

// Tablet: 2 columns
<div className="md:grid md:grid-cols-2 md:gap-6">
  {/* Tablet layout */}
</div>

// Desktop: 3 columns
<div className="lg:grid lg:grid-cols-3 lg:gap-8">
  {/* Desktop layout */}
</div>
```

### Common Responsive Patterns

**Hidden/Visible Elements**:
```typescript
{/* Mobile only */}
<div className="lg:hidden">Mobile Content</div>

{/* Desktop only */}
<div className="hidden lg:block">Desktop Content</div>
```

**Responsive Typography**:
```typescript
<h1 className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl">
  Responsive Heading
</h1>
```

**Responsive Spacing**:
```typescript
<div className="p-4 md:p-6 lg:p-8">
  Responsive Padding
</div>
```

---

## Testing Strategy

### Test Setup

```typescript
// tests/setup.ts
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Setup MSW server
export const server = setupServer(...handlers);

// Establish API mocking before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Reset handlers after each test
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => server.close());
```

```typescript
// tests/utils/test-utils.tsx
import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { store } from '@/store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function AllTheProviders({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    </Provider>
  );
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
```

### MSW Handlers

```typescript
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

const API_BASE_URL = 'http://localhost:3000';

export const handlers = [
  // Auth handlers
  http.post(`${API_BASE_URL}/auth/login`, () => {
    return HttpResponse.json({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        id: '1',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'ADMIN',
        tenantId: 'tenant-1',
      },
    });
  }),

  // User handlers
  http.get(`${API_BASE_URL}/users`, () => {
    return HttpResponse.json([
      {
        id: '1',
        email: 'user@example.com',
        fullName: 'Test User',
        role: 'ADMIN',
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }),

  http.get(`${API_BASE_URL}/users/me`, () => {
    return HttpResponse.json({
      id: '1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'ADMIN',
      status: 'ACTIVE',
      tenantId: 'tenant-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),

  // Customer handlers
  http.get(`${API_BASE_URL}/customers`, () => {
    return HttpResponse.json([
      {
        id: '1',
        code: 'CUST001',
        name: 'Test Customer',
        channel: 'RETAIL',
        type: 'DIRECT',
        status: 'ACTIVE',
        isVip: false,
        tenantId: 'tenant-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }),
];
```

### Component Test Example

```typescript
// tests/components/LoginForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/tests/utils/test-utils';
import { LoginForm } from '@/components/forms/LoginForm';
import { useLogin } from '@/services/auth.service';
import * as router from 'react-router-dom';

vi.mock('@/services/auth.service');
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('LoginForm', () => {
  const mockMutate = vi.fn();
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.mocked(useLogin).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      error: null,
    } as any);

    vi.spyOn(router, 'useNavigate').mockReturnValue(mockNavigate);
  });

  it('renders login form fields', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('validates email format', async () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
  });

  it('validates password length', async () => {
    render(<LoginForm />);

    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(passwordInput, { target: { value: 'short' } });
    fireEvent.blur(passwordInput);

    await waitFor(() => {
      expect(
        screen.getByText(/password must be at least 8 characters/i)
      ).toBeInTheDocument();
    });
  });

  it('submits form with valid data', async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });
});
```

### Service Test Example

```typescript
// tests/services/customers.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { server } from '@/tests/setup';
import { http, HttpResponse } from 'msw';
import { useCustomers, useCustomer } from '@/services/customers.service';

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('customers service', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('fetches customers list', async () => {
    server.use(
      http.get('http://localhost:3000/customers', () => {
        return HttpResponse.json([
          {
            id: '1',
            code: 'CUST001',
            name: 'Test Customer',
            channel: 'RETAIL',
            type: 'DIRECT',
            status: 'ACTIVE',
            isVip: false,
            tenantId: 'tenant-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
      })
    );

    const { result } = renderHook(() => useCustomers(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].code).toBe('CUST001');
  });

  it('fetches single customer', async () => {
    server.use(
      http.get('http://localhost:3000/customers/1', () => {
        return HttpResponse.json({
          id: '1',
          code: 'CUST001',
          name: 'Test Customer',
          channel: 'RETAIL',
          type: 'DIRECT',
          status: 'ACTIVE',
          isVip: false,
          tenantId: 'tenant-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      })
    );

    const { result } = renderHook(() => useCustomer('1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.code).toBe('CUST001');
  });
});
```

---

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Use functional components with hooks
- Prefer named exports over default exports
- Use meaningful variable and function names

### Component Guidelines

- Keep components small and focused
- Extract reusable logic into custom hooks
- Use TypeScript interfaces for props
- Implement proper error handling
- Add loading and empty states

### State Management Guidelines

- Use Redux Toolkit for global UI state (auth, theme, sidebar, etc.)
- Use TanStack Query for server state (API data)
- Keep component state local when possible
- Use Zustand for feature-specific state if needed

### Testing Guidelines

- Write tests for critical user flows
- Test components in isolation
- Use MSW for API mocking
- Aim for >80% code coverage
- Test accessibility where applicable

### Performance Guidelines

- Use React.memo for expensive components
- Implement proper loading states
- Use TanStack Query's caching effectively
- Lazy load routes and heavy components
- Optimize images and assets

---

## Environment Variables

Create a `.env` file in the root directory:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_NAME=CollMind TPM
VITE_APP_VERSION=1.0.0
```

---

## Package.json Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@reduxjs/toolkit": "^2.0.0",
    "react-redux": "^9.0.0",
    "@tanstack/react-query": "^5.17.0",
    "axios": "^1.6.0",
    "react-hook-form": "^7.49.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "tailwindcss": "^3.4.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.300.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.1.0",
    "@testing-library/jest-dom": "^6.1.0",
    "@testing-library/user-event": "^14.5.0",
    "msw": "^2.0.0",
    "eslint": "^8.56.0",
    "prettier": "^3.1.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0"
  }
}
```

---

## Getting Started

1. Install dependencies: `npm install`
2. Set up environment variables (copy `.env.example` to `.env`)
3. Start development server: `npm run dev`
4. Run tests: `npm test`
5. Build for production: `npm run build`

---

## Next Steps

- Set up shadcn/ui components
- Implement authentication flow
- Create protected routes
- Build user management UI
- Build customer management UI
- Implement search and filtering
- Add error boundaries
- Set up error tracking (Sentry)
- Configure analytics (Google Analytics)

---

**Document Version**: 1.0.0  
**Last Updated**: 2024  
**Author**: CollMind Development Team
