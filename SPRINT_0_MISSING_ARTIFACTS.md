# Sprint 0 Missing Artifacts
## State Machines, Sequence Diagrams, and Pseudocode

**Purpose:** Complete Sprint 0 architectural validation artifacts  
**Status:** 📝 Draft - To be completed  
**Reference:** `.cursordocs/sprint_0_rules.md`

---

## 📋 Missing Artifacts Checklist

- [ ] State Machine: Budget Reservation Workflow
- [ ] State Machine: Agreement Lifecycle
- [ ] State Machine: Budget Envelope Lifecycle
- [ ] Sequence Diagram: Budget Reservation Flow
- [ ] Sequence Diagram: Approval Workflow
- [ ] Sequence Diagram: Customer Import Flow (Error Handling)
- [ ] Pseudocode: Budget Reservation with Concurrency Control
- [ ] Pseudocode: Approval Workflow
- [ ] Pseudocode: Batch Import Error Handling

---

## 1. STATE MACHINES

### 1.1 Budget Reservation State Machine

**States:**
```
PENDING → APPROVED → COMMITTED
PENDING → REJECTED
PENDING → CANCELLED
```

**State Definitions:**
- **PENDING**: Reservation created, awaiting approval
- **APPROVED**: Reservation approved by approver, budget committed
- **REJECTED**: Reservation rejected by approver, budget released
- **COMMITTED**: Budget actually spent (agreement executed)
- **CANCELLED**: Reservation cancelled by requester before approval

**Transitions:**
```
PENDING --[approve(approverId)]--> APPROVED
PENDING --[reject(approverId, reason)]--> REJECTED
PENDING --[cancel(requesterId)]--> CANCELLED
APPROVED --[commit(agreementId)]--> COMMITTED
```

**Guard Conditions:**
- `approve()`: Requires APPROVER or ADMIN role, cannot be self-approval (EA-001)
- `reject()`: Requires APPROVER or ADMIN role
- `cancel()`: Only requester can cancel, must be PENDING
- `commit()`: Only after agreement is executed

**Side Effects:**
- `approve()`: Budget amount reserved, notification sent
- `reject()`: Budget amount released back to envelope, notification sent
- `cancel()`: Budget amount released back to envelope
- `commit()`: Budget consumed, cannot be reversed

---

### 1.2 Agreement Lifecycle State Machine

**States:**
```
DRAFT → SUBMITTED → APPROVED → ACTIVE → EXPIRED
DRAFT → SUBMITTED → REJECTED
ACTIVE → TERMINATED
```

**State Definitions:**
- **DRAFT**: Agreement being created by Planner
- **SUBMITTED**: Agreement submitted for approval
- **APPROVED**: Agreement approved by Approver
- **REJECTED**: Agreement rejected by Approver
- **ACTIVE**: Agreement in effect (start date reached)
- **EXPIRED**: Agreement end date passed
- **TERMINATED**: Agreement terminated early

**Transitions:**
```
DRAFT --[submit(plannerId)]--> SUBMITTED
SUBMITTED --[approve(approverId)]--> APPROVED
SUBMITTED --[reject(approverId, reason)]--> REJECTED
APPROVED --[activate(startDate)]--> ACTIVE
ACTIVE --[expire(endDate)]--> EXPIRED
ACTIVE --[terminate(reason)]--> TERMINATED
```

**Guard Conditions:**
- `submit()`: Requires PLANNER role, budget reservation must exist
- `approve()`: Requires APPROVER role, cannot be self-approval
- `reject()`: Requires APPROVER role
- `activate()`: Automatic when start date reached
- `expire()`: Automatic when end date reached
- `terminate()`: Requires ADMIN or FINANCE role

**Side Effects:**
- `submit()`: Budget reservation created (PENDING), notification sent
- `approve()`: Budget reservation approved, notification sent
- `reject()`: Budget reservation rejected, notification sent
- `activate()`: Agreement becomes effective
- `expire()`: Notification sent 5 days before expiry

---

### 1.3 Budget Envelope State Machine

**States:**
```
DRAFT → ACTIVE → CLOSED → ARCHIVED
DRAFT → ACTIVE → CLOSED
```

**State Definitions:**
- **DRAFT**: Envelope created but not yet active
- **ACTIVE**: Envelope available for reservations
- **CLOSED**: Envelope closed (no new reservations)
- **ARCHIVED**: Envelope archived (historical data)

**Transitions:**
```
DRAFT --[activate(adminId)]--> ACTIVE
ACTIVE --[close(adminId)]--> CLOSED
CLOSED --[archive(adminId)]--> ARCHIVED
```

**Guard Conditions:**
- `activate()`: Requires ADMIN or FINANCE role
- `close()`: Requires ADMIN or FINANCE role, no pending reservations
- `archive()`: Requires ADMIN role, must be CLOSED

**Side Effects:**
- `activate()`: Envelope becomes available for reservations
- `close()`: No new reservations allowed, existing reservations continue
- `archive()`: Envelope moved to archive, read-only

---

## 2. SEQUENCE DIAGRAMS (Textual)

### 2.1 Budget Reservation Flow

```
Actor: Planner
System: BudgetService
Database: PostgreSQL

Planner -> BudgetService: reserveBudget(envelopeId, amount, agreementId)
BudgetService -> Database: SELECT FOR UPDATE envelope WHERE id = envelopeId
Database -> BudgetService: envelope (locked)
BudgetService -> BudgetService: validate(envelope.status == ACTIVE)
BudgetService -> BudgetService: validate(envelope.availableAmount >= amount)
BudgetService -> Database: INSERT reservation (status = PENDING)
Database -> BudgetService: reservationId
BudgetService -> Database: UPDATE envelope (availableAmount -= amount, consumedAmount += amount)
Database -> BudgetService: success
BudgetService -> NotificationService: sendNotification(APPROVAL_REQUESTED, approverId)
NotificationService -> EmailService: sendEmail(approverEmail, template)
BudgetService -> Planner: return reservation

Note: Pessimistic lock ensures no overcommitment
```

**Concurrency Scenario:**
```
Time | User A                    | User B                    | Database State
-----|---------------------------|---------------------------|------------------
T1   | SELECT FOR UPDATE        |                           | available: 10000
T2   | validate(available >= 2500) |                       | available: 10000 (locked)
T3   |                           | SELECT FOR UPDATE (WAIT) | available: 10000 (locked by A)
T4   | INSERT reservation       |                           | available: 10000 (locked)
T5   | UPDATE available -= 2500 |                           | available: 7500 (locked)
T6   | COMMIT                   |                           | available: 7500
T7   |                           | SELECT FOR UPDATE (OK)   | available: 7500 (locked by B)
T8   |                           | validate(available >= 2500) | available: 7500 (locked)
T9   |                           | INSERT reservation       | available: 7500 (locked)
T10  |                           | UPDATE available -= 2500 | available: 5000 (locked)
T11  |                           | COMMIT                   | available: 5000
```

---

### 2.2 Approval Workflow

```
Actor: Approver
System: BudgetService
Database: PostgreSQL
NotificationService: EmailService

Approver -> BudgetService: approveReservation(reservationId, approverId)
BudgetService -> Database: SELECT reservation WHERE id = reservationId
Database -> BudgetService: reservation
BudgetService -> BudgetService: validate(reservation.status == PENDING)
BudgetService -> BudgetService: validate(approverRole == APPROVER || ADMIN)
BudgetService -> BudgetService: validate(EA-001: approverId != reservation.requestedById)
BudgetService -> Database: UPDATE reservation (status = APPROVED, approvedById, approvedAt)
Database -> BudgetService: success
BudgetService -> NotificationService: sendNotification(APPROVAL_GRANTED, requesterId)
NotificationService -> EmailService: sendEmail(requesterEmail, template)
BudgetService -> Approver: return reservation

Alternative Flow (Reject):
Approver -> BudgetService: rejectReservation(reservationId, approverId, reason)
BudgetService -> Database: SELECT reservation + envelope
BudgetService -> BudgetService: validate(reservation.status == PENDING)
BudgetService -> Database: UPDATE envelope (availableAmount += reservedAmount, consumedAmount -= reservedAmount)
BudgetService -> Database: UPDATE reservation (status = REJECTED, rejectedReason)
BudgetService -> NotificationService: sendNotification(APPROVAL_REJECTED, requesterId)
BudgetService -> Approver: return reservation
```

---

### 2.3 Customer Import Flow (Error Handling)

```
Actor: Admin/Planner
System: CustomerService
FileParserService: FileParser
Database: PostgreSQL

Admin -> CustomerService: importFromFile(file)
CustomerService -> FileParser: parseExcel(file) OR parseCSV(file)
FileParser -> FileParser: readFile(file)
FileParser -> FileParser: mapToCustomerDtos(rows)
FileParser -> CustomerService: customersWithRowNumbers[]

CustomerService -> CustomerService: validateAllRows(customers)
loop for each customer
    CustomerService -> CustomerService: validateCustomerDto(customer)
    alt [valid]
        CustomerService -> CustomerService: addToValidCustomers[]
    else [invalid]
        CustomerService -> CustomerService: addToErrors[] (error_type, error_message, original_row_data)
    end
end

CustomerService -> CustomerService: checkDuplicatesInFile(validCustomers)
loop for each valid customer
    alt [duplicate in file]
        CustomerService -> CustomerService: addToErrors[] (DUPLICATE_IN_FILE)
    end
end

CustomerService -> Database: BEGIN TRANSACTION
loop for each unique valid customer
    CustomerService -> Database: SELECT customer WHERE code = customer.code
    alt [exists]
        CustomerService -> CustomerService: addToErrors[] (ALREADY_EXISTS)
    else [not exists]
        CustomerService -> Database: INSERT customer
        alt [success]
            CustomerService -> CustomerService: incrementCreated
        else [database error]
            CustomerService -> CustomerService: addToErrors[] (DATABASE_ERROR)
        end
    end
end
Database -> CustomerService: COMMIT

CustomerService -> Admin: return { total, created, skipped, errors[] }
```

---

## 3. PSEUDOCODE FOR CRITICAL FLOWS

### 3.1 Budget Reservation with Concurrency Control

```pseudocode
FUNCTION reserveBudget(tenantId, userId, envelopeId, amount, agreementId):
    BEGIN TRANSACTION WITH ISOLATION LEVEL SERIALIZABLE
    
    TRY:
        // MC-001: Pessimistic lock on envelope
        envelope = SELECT * FROM budget_envelopes 
                   WHERE id = envelopeId AND tenant_id = tenantId
                   FOR UPDATE NOWAIT
        
        IF envelope IS NULL:
            THROW NotFoundException("Envelope not found")
        
        IF envelope.status != 'ACTIVE':
            THROW BadRequestException("Envelope not active")
        
        IF envelope.available_amount < amount:
            THROW BadRequestException("Insufficient budget")
        
        // Create reservation
        reservation = INSERT INTO budget_reservations (
            envelope_id, agreement_id, reserved_amount, 
            status, requested_by_id, tenant_id
        ) VALUES (
            envelopeId, agreementId, amount, 
            'PENDING', userId, tenantId
        )
        
        // Update envelope atomically
        UPDATE budget_envelopes 
        SET available_amount = available_amount - amount,
            consumed_amount = consumed_amount + amount
        WHERE id = envelopeId
        
        COMMIT
        
        // Send notification (async, outside transaction)
        SEND_NOTIFICATION('APPROVAL_REQUESTED', approverId, reservation)
        
        RETURN reservation
        
    CATCH LockTimeoutException:
        ROLLBACK
        // Retry logic (max 3 attempts, exponential backoff)
        IF retryCount < 3:
            WAIT(2^retryCount * 100ms)
            RETURN reserveBudget(...) // Retry
        ELSE:
            THROW BadRequestException("Budget reservation timeout")
    
    CATCH Exception:
        ROLLBACK
        THROW Exception
END FUNCTION
```

**Concurrency Guarantees:**
- Same envelope: Serialized (pessimistic lock)
- Different envelopes: Parallel (no contention)
- Zero overcommitment: Guaranteed by database lock

---

### 3.2 Approval Workflow

```pseudocode
FUNCTION approveReservation(tenantId, reservationId, approverId, approverRole):
    reservation = SELECT * FROM budget_reservations 
                  WHERE id = reservationId AND tenant_id = tenantId
    
    IF reservation IS NULL:
        THROW NotFoundException("Reservation not found")
    
    IF reservation.status != 'PENDING':
        THROW BadRequestException("Reservation not pending")
    
    // EA-001: Admin cannot approve own reservations
    IF approverRole == 'ADMIN' AND reservation.requested_by_id == approverId:
        THROW ForbiddenException("Admin cannot approve own reservation")
    
    // Update reservation
    UPDATE budget_reservations 
    SET status = 'APPROVED',
        approved_by_id = approverId,
        approved_at = NOW()
    WHERE id = reservationId
    
    // Send notification
    SEND_NOTIFICATION('APPROVAL_GRANTED', reservation.requested_by_id, reservation)
    
    RETURN reservation
END FUNCTION

FUNCTION rejectReservation(tenantId, reservationId, approverId, reason):
    reservation = SELECT * FROM budget_reservations 
                  WHERE id = reservationId AND tenant_id = tenantId
    
    IF reservation IS NULL:
        THROW NotFoundException("Reservation not found")
    
    IF reservation.status != 'PENDING':
        THROW BadRequestException("Reservation not pending")
    
    BEGIN TRANSACTION
    
    // Release budget back to envelope
    envelope = SELECT * FROM budget_envelopes 
               WHERE id = reservation.envelope_id
               FOR UPDATE
    
    UPDATE budget_envelopes 
    SET available_amount = available_amount + reservation.reserved_amount,
        consumed_amount = consumed_amount - reservation.reserved_amount
    WHERE id = reservation.envelope_id
    
    // Update reservation
    UPDATE budget_reservations 
    SET status = 'REJECTED',
        approved_by_id = approverId,
        approved_at = NOW(),
        rejected_reason = reason
    WHERE id = reservationId
    
    COMMIT
    
    // Send notification
    SEND_NOTIFICATION('APPROVAL_REJECTED', reservation.requested_by_id, reservation)
    
    RETURN reservation
END FUNCTION
```

---

### 3.3 Batch Import Error Handling (AI-001)

```pseudocode
FUNCTION importFromFile(tenantId, file):
    // Step 1: Parse file
    IF file.extension == 'xlsx' OR file.extension == 'xls':
        customers = PARSE_EXCEL(file)
    ELSE IF file.extension == 'csv':
        customers = PARSE_CSV(file)
    ELSE:
        THROW BadRequestException("Unsupported file format")
    
    // Step 2: Validate all rows BEFORE any insert (AI-001)
    errors = []
    validCustomers = []
    
    FOR EACH customer IN customers:
        validationError = validateCustomerDto(customer)
        
        IF validationError IS NOT NULL:
            errors.append({
                row: customer.originalRowNumber,
                code: customer.code || 'N/A',
                error_type: validationError.type,
                error_message: validationError.message,
                original_row_data: customer.originalRowData
            })
        ELSE:
            validCustomers.append(customer)
    
    // Edge case: All rows invalid
    IF validCustomers.length == 0:
        RETURN {
            total: customers.length,
            created: 0,
            skipped: customers.length,
            errors: errors
        }
    
    // Step 3: Check duplicates in file
    seenCodes = SET()
    FOR EACH customer IN validCustomers:
        IF customer.code IN seenCodes:
            errors.append({
                row: customer.originalRowNumber,
                code: customer.code,
                error_type: 'DUPLICATE_IN_FILE',
                error_message: 'Code appears multiple times in file',
                original_row_data: customer.originalRowData
            })
        ELSE:
            seenCodes.add(customer.code)
    
    // Step 4: Insert valid customers
    created = 0
    uniqueValidCustomers = validCustomers.filter(not in duplicateErrors)
    
    FOR EACH customer IN uniqueValidCustomers:
        TRY:
            existing = SELECT * FROM customers 
                       WHERE code = customer.code AND tenant_id = tenantId
            
            IF existing IS NOT NULL:
                errors.append({
                    row: customer.originalRowNumber,
                    code: customer.code,
                    error_type: 'ALREADY_EXISTS',
                    error_message: 'Customer with this code already exists',
                    original_row_data: customer.originalRowData
                })
            ELSE:
                INSERT INTO customers (code, name, channel, tenant_id, ...)
                VALUES (customer.code, customer.name, customer.channel, tenantId, ...)
                created++
        
        CATCH DatabaseException AS e:
            errors.append({
                row: customer.originalRowNumber,
                code: customer.code || 'N/A',
                error_type: 'DATABASE_ERROR',
                error_message: e.message,
                original_row_data: customer.originalRowData
            })
    
    RETURN {
        total: customers.length,
        created: created,
        skipped: errors.length,
        errors: errors
    }
END FUNCTION

FUNCTION validateCustomerDto(customer):
    // Required fields
    IF customer.code IS NULL OR customer.code.trim() == '':
        RETURN { type: 'MISSING_FIELD', message: 'code is required' }
    
    IF customer.name IS NULL OR customer.name.trim() == '':
        RETURN { type: 'MISSING_FIELD', message: 'name is required' }
    
    IF customer.channel IS NULL:
        RETURN { type: 'MISSING_FIELD', message: 'channel is required' }
    
    // Date format validation
    IF customer.lastOrderDate AND NOT MATCH(customer.lastOrderDate, 'YYYY-MM-DD'):
        RETURN { type: 'INVALID_DATE', message: 'lastOrderDate must be YYYY-MM-DD' }
    
    // Amount validation
    IF customer.annualRevenue IS NOT NULL AND customer.annualRevenue < 0:
        RETURN { type: 'INVALID_AMOUNT', message: 'annualRevenue cannot be negative' }
    
    // Email validation
    IF customer.contactEmail AND NOT IS_VALID_EMAIL(customer.contactEmail):
        RETURN { type: 'INVALID_EMAIL', message: 'contactEmail format is invalid' }
    
    RETURN NULL // Valid
END FUNCTION
```

**Key Principles (AI-001):**
1. **All validation BEFORE insert**: No partial commits
2. **Detailed error report**: Row number, error type, original data
3. **Partial success**: Valid rows imported, invalid rows reported
4. **No data loss**: Original row data preserved in error report

---

## 4. IMPLEMENTATION PLAN

### Phase 1: Document State Machines
- [ ] Create `docs/sprint0/state-machines.md`
- [ ] Document Budget Reservation state machine
- [ ] Document Agreement lifecycle state machine
- [ ] Document Budget Envelope state machine

### Phase 2: Document Sequence Diagrams
- [ ] Create `docs/sprint0/sequence-diagrams.md`
- [ ] Document Budget Reservation flow
- [ ] Document Approval workflow
- [ ] Document Customer Import flow

### Phase 3: Document Pseudocode
- [ ] Create `docs/sprint0/pseudocode.md`
- [ ] Document Budget Reservation pseudocode
- [ ] Document Approval workflow pseudocode
- [ ] Document Batch Import pseudocode

### Phase 4: Review & Validation
- [ ] Review with Engineering Lead
- [ ] Validate against domain requirements
- [ ] Update Sprint 0 checklist

---

## 5. NOTES

**These artifacts are for Sprint 0 only:**
- Not production code
- Architectural validation
- Risk elimination
- Design decision documentation

**Next Steps:**
- These artifacts will guide Phase 1 implementation
- State machines will become enum types
- Sequence diagrams will guide API design
- Pseudocode will become service methods

---

**Status:** 📝 Draft  
**Last Updated:** January 2026  
**Next Review:** Before Phase 1 Week 1


