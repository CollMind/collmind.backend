# Sprint 0: Vue.js Backend API Documentation
## Backend Implementation Guide for Frontend Development

**Date:** January 2026  
**Version:** 1.0  
**Status:** Sprint 0 Complete

---

## Table of Contents

1. [API Overview](#api-overview)
2. [Authentication & Authorization](#authentication--authorization)
3. [API Endpoints](#api-endpoints)
   - [Auth](#auth-endpoints)
   - [Users](#users-endpoints)
   - [Customers](#customers-endpoints)
   - [Budget](#budget-endpoints)
   - [Tenants](#tenants-endpoints)
   - [Notifications](#notifications-endpoints)
4. [Request/Response Formats](#requestresponse-formats)
5. [Error Handling](#error-handling)
6. [Use Cases & Scenarios](#use-cases--scenarios)
7. [API Integration Examples](#api-integration-examples)

---

## API Overview

### Base URL
```
http://localhost:3000/api
```

### Authentication
All endpoints (except `/auth/login` and `/auth/refresh`) require JWT Bearer token authentication.

### Headers
```javascript
{
  'Authorization': 'Bearer <access_token>',
  'Content-Type': 'application/json',
  'x-tenant-id': '<tenant_id>' // Optional, auto-resolved from user
}
```

### Response Format
All successful responses return JSON. Error responses follow standard HTTP status codes.

---

## Authentication & Authorization

### User Roles
- `ADMIN` - Full system access
- `PLANNER` - Create agreements, manage customers
- `APPROVER` - Approve agreements and budget actions
- `FINANCE` - Budget management, financial reporting

### Role-Based Access
Endpoints are protected by role guards. Check each endpoint's required roles below.

---

## API Endpoints

### Auth Endpoints

#### POST `/auth/login`
**Description:** User login and token generation

**Request:**
```json
{
  "email": "john.doe@acme.com",
  "password": "SecurePassword123!",
  "ipAddress": "192.168.1.1" // Optional
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "john.doe@acme.com",
    "fullName": "John Doe",
    "role": "PLANNER",
    "tenantId": "uuid"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid credentials

**Use Case:** User login flow

---

#### POST `/auth/refresh`
**Description:** Refresh access token using refresh token

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):** Same as `/auth/login`

**Error Responses:**
- `401 Unauthorized` - Invalid refresh token

**Use Case:** Token refresh flow

---

#### POST `/auth/logout`
**Description:** User logout (invalidates refresh token)

**Headers:** `Authorization: Bearer <token>`

**Response (204):** No content

**Use Case:** User logout flow

---

### Users Endpoints

#### POST `/users`
**Description:** Create a new user

**Required Role:** `ADMIN`

**Request:**
```json
{
  "email": "jane.doe@acme.com",
  "password": "SecurePassword123!",
  "fullName": "Jane Doe",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "PLANNER",
  "status": "PENDING",
  "phoneNumber": "+90 555 123 4567",
  "department": "Sales",
  "jobTitle": "Sales Manager",
  "mustChangePassword": false
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "email": "jane.doe@acme.com",
  "fullName": "Jane Doe",
  "role": "PLANNER",
  "status": "PENDING",
  "tenantId": "uuid",
  "createdAt": "2026-01-08T10:00:00Z",
  "updatedAt": "2026-01-08T10:00:00Z"
}
```

**Use Case:** Admin creates new user

---

#### GET `/users`
**Description:** Get all users

**Required Role:** `ADMIN`, `FINANCE`

**Response (200):**
```json
[
  {
    "id": "uuid",
    "email": "john.doe@acme.com",
    "fullName": "John Doe",
    "role": "PLANNER",
    "status": "ACTIVE",
    "tenantId": "uuid",
    "createdAt": "2026-01-08T10:00:00Z"
  }
]
```

**Use Case:** User management list

---

#### GET `/users/me`
**Description:** Get current user profile

**Response (200):** Same as user object above

**Use Case:** Profile page

---

#### PATCH `/users/me`
**Description:** Update current user profile

**Request:**
```json
{
  "fullName": "John Updated",
  "phoneNumber": "+90 555 999 8888",
  "department": "Marketing"
}
```

**Response (200):** Updated user object

**Use Case:** Profile edit

---

#### PATCH `/users/me/password`
**Description:** Change current user password

**Request:**
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!",
  "confirmPassword": "NewPassword123!"
}
```

**Response (204):** No content

**Use Case:** Password change

---

#### GET `/users/:id`
**Description:** Get user by ID

**Response (200):** User object

**Use Case:** User detail page

---

#### PATCH `/users/:id`
**Description:** Update user (Admin only)

**Required Role:** `ADMIN`

**Request:** Same as PATCH `/users/me`

**Response (200):** Updated user object

**Use Case:** Admin edits user

---

#### POST `/users/:id/activate`
**Description:** Activate user

**Required Role:** `ADMIN`

**Response (200):** User object with status `ACTIVE`

**Use Case:** Activate pending user

---

#### POST `/users/:id/deactivate`
**Description:** Deactivate user

**Required Role:** `ADMIN`

**Response (200):** User object with status `INACTIVE`

**Use Case:** Deactivate user

---

#### DELETE `/users/:id`
**Description:** Delete user

**Required Role:** `ADMIN`

**Response (204):** No content

**Use Case:** Delete user

---

### Customers Endpoints

#### POST `/customers`
**Description:** Create a new customer

**Required Role:** `ADMIN`, `PLANNER`

**Request:**
```json
{
  "code": "CUST001",
  "name": "Metro Türkiye",
  "channel": "NKA",
  "type": "DIRECT",
  "status": "ACTIVE",
  "city": "Istanbul",
  "district": "Beşiktaş",
  "region": "Marmara",
  "country": "Turkey",
  "address": "Metro Plaza, Beşiktaş",
  "postalCode": "34349",
  "taxNumber": "1234567890",
  "taxOffice": "Beşiktaş",
  "companyRegistrationNumber": "1234567890",
  "contactPerson": "Ahmet Yılmaz",
  "contactEmail": "ahmet.yilmaz@metro.com.tr",
  "contactPhone": "+90 212 555 1234",
  "contactMobile": "+90 555 123 4567",
  "paymentTerms": "NET30",
  "creditLimit": 1000000,
  "currency": "TRY",
  "salesRepresentative": "John Doe",
  "accountManager": "Jane Smith",
  "customerGroup": "A",
  "customerSegment": "Large",
  "customerTier": "Premium",
  "businessSize": "Large",
  "annualRevenue": 50000000,
  "numberOfBranches": 25,
  "isVip": true,
  "notes": "Key account customer"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "code": "CUST001",
  "name": "Metro Türkiye",
  "channel": "NKA",
  "type": "DIRECT",
  "status": "ACTIVE",
  "tenantId": "uuid",
  "createdAt": "2026-01-08T10:00:00Z"
}
```

**Use Case:** Create new customer

---

#### POST `/customers/bulk`
**Description:** Create multiple customers

**Required Role:** `ADMIN`, `PLANNER`

**Request:**
```json
{
  "customers": [
    {
      "code": "CUST001",
      "name": "Customer 1",
      "channel": "NKA"
    },
    {
      "code": "CUST002",
      "name": "Customer 2",
      "channel": "TRADITIONAL"
    }
  ]
}
```

**Response (201):** Array of created customers

**Use Case:** Bulk customer import

---

#### GET `/customers`
**Description:** Get all customers with filters

**Query Parameters:**
- `search` (string) - Search term
- `channel` (string) - Filter by channel
- `status` (string) - Filter by status
- `city` (string) - Filter by city
- `isVip` (boolean) - Filter VIP customers
- `page` (number) - Page number (default: 1)
- `limit` (number) - Items per page (default: 10)
- `sortBy` (string) - Sort field (default: 'name')
- `sortOrder` ('ASC' | 'DESC') - Sort order (default: 'ASC')

**Response (200):**
```json
[
  {
    "id": "uuid",
    "code": "CUST001",
    "name": "Metro Türkiye",
    "channel": "NKA",
    "status": "ACTIVE",
    "city": "Istanbul",
    "numberOfBranches": 25,
    "isVip": true
  }
]
```

**Use Case:** Customer list with filters

---

#### GET `/customers/search?q=metro`
**Description:** Search customers

**Response (200):** Array of matching customers

**Use Case:** Customer search

---

#### GET `/customers/channel/:channel`
**Description:** Get customers by channel

**Response (200):** Array of customers

**Use Case:** Filter by channel

---

#### GET `/customers/city/:city`
**Description:** Get customers by city

**Response (200):** Array of customers

**Use Case:** Filter by city

---

#### GET `/customers/vip`
**Description:** Get VIP customers

**Response (200):** Array of VIP customers

**Use Case:** VIP customer list

---

#### GET `/customers/:id`
**Description:** Get customer by ID

**Response (200):** Customer object

**Use Case:** Customer detail page

---

#### GET `/customers/code/:code`
**Description:** Get customer by code

**Response (200):** Customer object

**Use Case:** Find customer by code

---

#### PATCH `/customers/:id`
**Description:** Update customer

**Required Role:** `ADMIN`, `PLANNER`

**Request:** Partial customer object

**Response (200):** Updated customer object

**Use Case:** Edit customer

---

#### DELETE `/customers/:id`
**Description:** Delete customer

**Required Role:** `ADMIN`, `PLANNER`

**Response (204):** No content

**Use Case:** Delete customer

---

#### POST `/customers/:id/activate`
**Description:** Activate customer

**Required Role:** `ADMIN`, `PLANNER`

**Response (200):** Customer object with status `ACTIVE`

**Use Case:** Activate customer

---

#### POST `/customers/:id/deactivate`
**Description:** Deactivate customer

**Required Role:** `ADMIN`, `PLANNER`

**Response (200):** Customer object with status `INACTIVE`

**Use Case:** Deactivate customer

---

#### GET `/customers/:id/stats`
**Description:** Get customer statistics

**Response (200):**
```json
{
  "totalOrders": 150,
  "totalRevenue": 5000000,
  "lastOrderDate": "2026-01-05",
  "averageOrderValue": 33333.33
}
```

**Use Case:** Customer dashboard

---

#### POST `/customers/import`
**Description:** Import customers from Excel/CSV file

**Required Role:** `ADMIN`, `PLANNER`

**Content-Type:** `multipart/form-data`

**Request:** Form data with `file` field

**Response (201):**
```json
{
  "total": 100,
  "created": 95,
  "skipped": 5,
  "errors": [
    {
      "row": 3,
      "code": "CUST003",
      "error_type": "ALREADY_EXISTS",
      "error_message": "Customer with code CUST003 already exists",
      "original_row_data": {
        "code": "CUST003",
        "name": "Customer 3"
      }
    }
  ]
}
```

**Error Types:**
- `MISSING_FIELD` - Required field missing
- `INVALID_DATE` - Invalid date format
- `INVALID_AMOUNT` - Invalid numeric value
- `ALREADY_EXISTS` - Customer code already exists
- `DUPLICATE_IN_FILE` - Duplicate code in file
- `DATABASE_ERROR` - Database error
- `INVALID_EMAIL` - Invalid email format

**Use Case:** Bulk customer import from file

---

### Budget Endpoints

#### POST `/budget/envelopes`
**Description:** Create a new budget envelope

**Required Role:** `ADMIN`, `FINANCE`

**Request:**
```json
{
  "code": "NKA/Hair/Jan",
  "name": "NKA Hair Care January Budget",
  "fiscalYear": "2024",
  "period": "Jan",
  "allocatedAmount": 100000,
  "status": "DRAFT",
  "budgetOwnerId": "uuid",
  "budgetOwnerEmail": "owner@example.com",
  "budgetOwnerName": "John Doe",
  "currency": "TRY",
  "description": "January budget for NKA Hair Care",
  "metadata": {}
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "code": "NKA/Hair/Jan",
  "name": "NKA Hair Care January Budget",
  "fiscalYear": "2024",
  "period": "Jan",
  "allocatedAmount": 100000,
  "consumedAmount": 0,
  "availableAmount": 100000,
  "status": "DRAFT",
  "currency": "TRY",
  "tenantId": "uuid",
  "createdAt": "2026-01-08T10:00:00Z"
}
```

**Use Case:** Create budget envelope

---

#### GET `/budget/envelopes`
**Description:** Get all budget envelopes

**Response (200):**
```json
[
  {
    "id": "uuid",
    "code": "NKA/Hair/Jan",
    "name": "NKA Hair Care January Budget",
    "allocatedAmount": 100000,
    "consumedAmount": 15000,
    "availableAmount": 75000,
    "status": "ACTIVE"
  }
]
```

**Use Case:** Budget envelope list

---

#### GET `/budget/envelopes/:id`
**Description:** Get budget envelope by ID

**Response (200):** Budget envelope object

**Use Case:** Budget envelope detail

---

#### POST `/budget/reserve`
**Description:** Reserve budget from an envelope (Event-sourced: creates RESERVE transaction)

**Required Role:** `PLANNER`, `ADMIN`

**Request:**
```json
{
  "envelopeId": "uuid",
  "agreementId": "uuid",
  "amount": 25000,
  "currency": "TRY"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "envelopeId": "uuid",
  "txType": "RESERVE",
  "txStatus": "POSTED",
  "sourceType": "AGREEMENT",
  "sourceId": "uuid",
  "amount": 25000,
  "currency": "TRY",
  "idempotencyKey": "RESERVE|AGREEMENT|uuid|uuid",
  "description": "Budget reservation for agreement uuid",
  "createdAt": "2026-01-08T10:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request` - Insufficient budget or invalid request
- `404 Not Found` - Envelope not found
- `409 Conflict` - Reservation already exists (idempotency)

**Use Case:** Reserve budget when agreement is approved

---

#### GET `/budget/envelopes/:id/reserved`
**Description:** Get reserved amount for an envelope (computed from transactions)

**Response (200):**
```json
{
  "envelopeId": "uuid",
  "reservedAmount": 25000
}
```

**Use Case:** Check reserved budget

---

#### GET `/budget/envelopes/:id/transactions`
**Description:** Get all transactions for an envelope

**Response (200):**
```json
[
  {
    "id": "uuid",
    "txType": "RESERVE",
    "txStatus": "POSTED",
    "sourceType": "AGREEMENT",
    "sourceId": "uuid",
    "amount": 25000,
    "currency": "TRY",
    "createdAt": "2026-01-08T10:00:00Z"
  }
]
```

**Use Case:** Budget transaction history

---

### Tenants Endpoints

#### POST `/tenants`
**Description:** Create a new tenant

**Required Role:** `ADMIN`

**Request:**
```json
{
  "name": "Acme Corporation",
  "domain": "acme",
  "status": "TRIAL",
  "plan": "FREE",
  "contactEmail": "admin@acme.com",
  "contactPhone": "+90 212 555 1234",
  "contactPerson": "John Doe",
  "address": "123 Main St",
  "city": "Istanbul",
  "country": "Turkey",
  "postalCode": "34000",
  "taxNumber": "1234567890",
  "companyRegistrationNumber": "1234567890",
  "industry": "Retail",
  "settings": {
    "defaultCurrency": "TRY",
    "fiscalYearStart": "01-01",
    "timezone": "Europe/Istanbul",
    "dateFormat": "DD.MM.YYYY",
    "numberFormat": "tr-TR"
  }
}
```

**Response (201):** Tenant object

**Use Case:** Create new tenant

---

#### GET `/tenants`
**Description:** Get all tenants

**Required Role:** `ADMIN`

**Response (200):** Array of tenants

**Use Case:** Tenant management

---

#### GET `/tenants/:id`
**Description:** Get tenant by ID

**Response (200):** Tenant object

**Use Case:** Tenant detail

---

#### PATCH `/tenants/:id`
**Description:** Update tenant

**Required Role:** `ADMIN`

**Request:** Partial tenant object

**Response (200):** Updated tenant object

**Use Case:** Edit tenant

---

#### DELETE `/tenants/:id`
**Description:** Delete tenant

**Required Role:** `ADMIN`

**Response (204):** No content

**Use Case:** Delete tenant

---

#### POST `/tenants/:id/activate`
**Description:** Activate tenant

**Required Role:** `ADMIN`

**Response (200):** Tenant object with status `ACTIVE`

**Use Case:** Activate tenant

---

#### POST `/tenants/:id/suspend`
**Description:** Suspend tenant

**Required Role:** `ADMIN`

**Response (200):** Tenant object with status `SUSPENDED`

**Use Case:** Suspend tenant

---

#### GET `/tenants/:id/stats`
**Description:** Get tenant statistics

**Response (200):**
```json
{
  "totalUsers": 25,
  "totalCustomers": 150,
  "totalBudgetEnvelopes": 12,
  "totalAgreements": 45
}
```

**Use Case:** Tenant dashboard

---

### Notifications Endpoints

#### GET `/notifications`
**Description:** Get all notifications for current user

**Query Parameters:**
- `limit` (number) - Max notifications (default: 30)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "type": "APPROVAL_REQUEST",
    "title": "New approval request",
    "message": "Agreement STA-2026-025 requires your approval",
    "channel": "IN_APP",
    "priority": "HIGH",
    "status": "UNREAD",
    "readAt": null,
    "createdAt": "2026-01-08T10:00:00Z"
  }
]
```

**Use Case:** Notification list

---

#### GET `/notifications/unread`
**Description:** Get unread notifications for current user

**Response (200):** Array of unread notifications

**Use Case:** Unread notification count

---

#### POST `/notifications/:id/read`
**Description:** Mark notification as read

**Response (200):** Notification object with `status: "READ"`

**Use Case:** Mark notification as read

---

## Request/Response Formats

### Date Format
All dates are in ISO 8601 format: `YYYY-MM-DDTHH:mm:ssZ`

### Currency Format
All amounts are decimal numbers with 2 decimal places. Currency code is 3-letter ISO code (e.g., "TRY").

### UUID Format
All IDs are UUID v4 format.

### Pagination
Pagination uses `page` and `limit` query parameters. Default: `page=1`, `limit=10`.

### Sorting
Sorting uses `sortBy` and `sortOrder` query parameters. Default: `sortBy=name`, `sortOrder=ASC`.

---

## Error Handling

### Standard Error Response
```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

### Common HTTP Status Codes
- `200 OK` - Success
- `201 Created` - Resource created
- `204 No Content` - Success, no content
- `400 Bad Request` - Invalid request
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (e.g., duplicate)
- `500 Internal Server Error` - Server error

### Validation Errors
Validation errors return `400 Bad Request` with detailed messages:
```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 8 characters"
  ],
  "error": "Bad Request"
}
```

---

## Use Cases & Scenarios

### Scenario 1: User Login Flow
1. User enters email and password
2. Frontend calls `POST /auth/login`
3. Backend returns `accessToken`, `refreshToken`, and `user` object
4. Frontend stores tokens (localStorage/sessionStorage)
5. Frontend includes `Authorization: Bearer <token>` in subsequent requests

**Vue.js Implementation:**
```javascript
// services/auth.service.js
async login(email, password) {
  const response = await axios.post('/api/auth/login', {
    email,
    password
  });
  
  // Store tokens
  localStorage.setItem('accessToken', response.data.accessToken);
  localStorage.setItem('refreshToken', response.data.refreshToken);
  localStorage.setItem('user', JSON.stringify(response.data.user));
  
  return response.data;
}
```

---

### Scenario 2: Create Customer Flow
1. User fills customer form
2. Frontend validates form data
3. Frontend calls `POST /customers`
4. Backend creates customer and returns customer object
5. Frontend redirects to customer list or detail page

**Vue.js Implementation:**
```javascript
// services/customer.service.js
async createCustomer(customerData) {
  const response = await axios.post('/api/customers', customerData, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
    }
  });
  return response.data;
}
```

---

### Scenario 3: Budget Reservation Flow
1. Agreement is approved
2. Frontend calls `POST /budget/reserve` with agreement ID and amount
3. Backend checks available budget
4. Backend creates RESERVE transaction
5. Backend returns transaction object
6. Frontend updates budget display

**Vue.js Implementation:**
```javascript
// services/budget.service.js
async reserveBudget(envelopeId, agreementId, amount, currency = 'TRY') {
  const response = await axios.post('/api/budget/reserve', {
    envelopeId,
    agreementId,
    amount,
    currency
  }, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
    }
  });
  return response.data;
}
```

---

### Scenario 4: Customer Import Flow
1. User selects Excel/CSV file
2. Frontend creates FormData with file
3. Frontend calls `POST /customers/import`
4. Backend processes file and returns import results
5. Frontend displays success/error summary

**Vue.js Implementation:**
```javascript
// services/customer.service.js
async importCustomers(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await axios.post('/api/customers/import', formData, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      'Content-Type': 'multipart/form-data'
    }
  });
  return response.data;
}
```

---

### Scenario 5: Get Budget Envelope with Reserved Amount
1. User views budget envelope detail
2. Frontend calls `GET /budget/envelopes/:id`
3. Frontend calls `GET /budget/envelopes/:id/reserved`
4. Frontend displays allocated, reserved, consumed, and available amounts

**Vue.js Implementation:**
```javascript
// services/budget.service.js
async getEnvelopeWithReserved(envelopeId) {
  const [envelope, reserved] = await Promise.all([
    axios.get(`/api/budget/envelopes/${envelopeId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
    }),
    axios.get(`/api/budget/envelopes/${envelopeId}/reserved`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
    })
  ]);
  
  return {
    ...envelope.data,
    reservedAmount: reserved.data.reservedAmount,
    availableAmount: envelope.data.allocatedAmount - reserved.data.reservedAmount - envelope.data.consumedAmount
  };
}
```

---

### Scenario 6: Customer List with Filters
1. User applies filters (channel, status, search)
2. Frontend calls `GET /customers` with query parameters
3. Backend returns filtered customer list
4. Frontend displays results with pagination

**Vue.js Implementation:**
```javascript
// services/customer.service.js
async getCustomers(filters = {}) {
  const params = new URLSearchParams();
  
  if (filters.search) params.append('search', filters.search);
  if (filters.channel) params.append('channel', filters.channel);
  if (filters.status) params.append('status', filters.status);
  if (filters.page) params.append('page', filters.page);
  if (filters.limit) params.append('limit', filters.limit);
  
  const response = await axios.get(`/api/customers?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
    }
  });
  return response.data;
}
```

---

### Scenario 7: Token Refresh Flow
1. Access token expires
2. Frontend detects 401 error
3. Frontend calls `POST /auth/refresh` with refresh token
4. Backend returns new access token
5. Frontend retries original request with new token

**Vue.js Implementation:**
```javascript
// services/auth.service.js
async refreshToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  const response = await axios.post('/api/auth/refresh', { refreshToken });
  
  localStorage.setItem('accessToken', response.data.accessToken);
  localStorage.setItem('refreshToken', response.data.refreshToken);
  
  return response.data.accessToken;
}

// axios interceptor for auto-refresh
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      const newToken = await refreshToken();
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return axios.request(error.config);
    }
    return Promise.reject(error);
  }
);
```

---

### Scenario 8: Notification Management
1. User opens notification panel
2. Frontend calls `GET /notifications/unread`
3. Frontend displays unread count
4. User clicks notification
5. Frontend calls `POST /notifications/:id/read`
6. Frontend updates notification status

**Vue.js Implementation:**
```javascript
// services/notification.service.js
async getUnreadNotifications() {
  const response = await axios.get('/api/notifications/unread', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
    }
  });
  return response.data;
}

async markAsRead(notificationId) {
  const response = await axios.post(`/api/notifications/${notificationId}/read`, {}, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
    }
  });
  return response.data;
}
```

---

## API Integration Examples

### Axios Configuration
```javascript
// config/axios.js
import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:3000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - Add auth token
apiClient.interceptors.request.use(
  config => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => Promise.reject(error)
);

// Response interceptor - Handle errors
apiClient.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      // Handle token refresh
      // ... (see Scenario 7)
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

### Service Layer Example
```javascript
// services/customer.service.js
import apiClient from '@/config/axios';

export const customerService = {
  async getAll(filters = {}) {
    const params = new URLSearchParams();
    Object.keys(filters).forEach(key => {
      if (filters[key] !== undefined && filters[key] !== null) {
        params.append(key, filters[key]);
      }
    });
    
    const response = await apiClient.get(`/customers?${params.toString()}`);
    return response.data;
  },
  
  async getById(id) {
    const response = await apiClient.get(`/customers/${id}`);
    return response.data;
  },
  
  async create(data) {
    const response = await apiClient.post('/customers', data);
    return response.data;
  },
  
  async update(id, data) {
    const response = await apiClient.patch(`/customers/${id}`, data);
    return response.data;
  },
  
  async delete(id) {
    await apiClient.delete(`/customers/${id}`);
  },
  
  async import(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post('/customers/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  }
};
```

---

### Vue Component Example
```vue
<template>
  <div>
    <button @click="loadCustomers">Load Customers</button>
    <ul>
      <li v-for="customer in customers" :key="customer.id">
        {{ customer.name }}
      </li>
    </ul>
  </div>
</template>

<script>
import { customerService } from '@/services/customer.service';

export default {
  data() {
    return {
      customers: []
    };
  },
  methods: {
    async loadCustomers() {
      try {
        this.customers = await customerService.getAll({
          channel: 'NKA',
          status: 'ACTIVE',
          page: 1,
          limit: 10
        });
      } catch (error) {
        console.error('Error loading customers:', error);
      }
    }
  }
};
</script>
```

---

## Summary

### Available Endpoints Summary

| Module | Endpoints | Total |
|--------|-----------|-------|
| Auth | 3 | 3 |
| Users | 11 | 11 |
| Customers | 15 | 15 |
| Budget | 6 | 6 |
| Tenants | 8 | 8 |
| Notifications | 3 | 3 |
| **Total** | | **46** |

### Key Features
- ✅ JWT Authentication
- ✅ Role-based Authorization
- ✅ Multi-tenant Support
- ✅ Budget Reservation (Event-sourced)
- ✅ Customer Import (Excel/CSV)
- ✅ Notification System
- ✅ Comprehensive Error Handling

---

**Last Updated:** January 2026  
**Version:** 1.0  
**Status:** Ready for Frontend Implementation


