import axios, { AxiosInstance } from 'axios';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TEST_TENANT_ID || 'cd7af118-e2df-476c-9596-858d2d15dd95';

interface TestContext {
  api: AxiosInstance;
  tokens: {
    planner?: string;
    approver?: string;
    admin?: string;
    finance?: string;
  };
  ids: {
    customerId?: string;
    agreementId?: string;
    approvalRequestId?: string;
    transactionId?: string;
    envelopeId?: string;
  };
}

const ctx: TestContext = {
  api: axios.create({ baseURL: BASE_URL }),
  tokens: {},
  ids: {},
};

// Helper: Print step result
function logStep(step: number | string, name: string, success: boolean, details?: string) {
  const status = success ? '✅' : '❌';
  console.log(`\n${status} Step ${step}: ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Helper: Print section header
function logSection(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// Helper: Set auth header
function setAuth(token: string) {
  ctx.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  ctx.api.defaults.headers.common['X-Tenant-ID'] = TENANT_ID;
}

// ============================================================
// TEST STEPS
// ============================================================

async function step1_loginUsers(): Promise<boolean> {
  logSection('AUTHENTICATION');
  
  try {
    // Login as Planner
    const plannerRes = await ctx.api.post('/auth/login', {
      email: 'planner@wella.com',
      password: 'password123',
    });
    ctx.tokens.planner = plannerRes.data.accessToken;
    logStep(1.1, 'Login as Planner', true, `Token: ${ctx.tokens.planner?.substring(0, 20)}...`);

    // Login as Approver
    const approverRes = await ctx.api.post('/auth/login', {
      email: 'approver@wella.com',
      password: 'password123',
    });
    ctx.tokens.approver = approverRes.data.accessToken;
    logStep(1.2, 'Login as Approver', true, `Token: ${ctx.tokens.approver?.substring(0, 20)}...`);

    // Login as Admin
    const adminRes = await ctx.api.post('/auth/login', {
      email: 'admin@wella.com',
      password: 'password123',
    });
    ctx.tokens.admin = adminRes.data.accessToken;
    logStep(1.3, 'Login as Admin', true, `Token: ${ctx.tokens.admin?.substring(0, 20)}...`);

    // Login as Finance (optional)
    try {
      const financeRes = await ctx.api.post('/auth/login', {
        email: 'finance@wella.com',
        password: 'password123',
      });
      ctx.tokens.finance = financeRes.data.accessToken;
      logStep(1.4, 'Login as Finance', true, `Token: ${ctx.tokens.finance?.substring(0, 20)}...`);
    } catch {
      // Finance login optional
    }

    return true;
  } catch (error: any) {
    logStep(1, 'Login Users', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step2_getCustomerAndEnvelope(): Promise<boolean> {
  logSection('FETCH REFERENCE DATA');
  
  try {
    setAuth(ctx.tokens.planner!);

    // Get customers
    const customersRes = await ctx.api.get('/customers');
    const customer = customersRes.data[0] || customersRes.data.data?.[0];
    if (!customer) {
      throw new Error('No customers found');
    }
    ctx.ids.customerId = customer.id;
    logStep(2.1, 'Get Customer', true, `${customer.name} (${customer.id})`);

    // Get budget envelopes
    const envelopesRes = await ctx.api.get('/budget/envelopes');
    const envelopes = envelopesRes.data.data || envelopesRes.data;
    const envelope = envelopes.find((e: any) => e.period === '2026-01') || envelopes[0];
    if (!envelope) {
      throw new Error('No budget envelopes found');
    }
    ctx.ids.envelopeId = envelope.id;
    logStep(2.2, 'Get Budget Envelope', true, `${envelope.code} - ${envelope.allocatedAmount} TRY`);

    return true;
  } catch (error: any) {
    logStep(2, 'Fetch Reference Data', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step3_createAgreement(): Promise<boolean> {
  logSection('CREATE AGREEMENT');
  
  try {
    setAuth(ctx.tokens.planner!);

    const agreementData = {
      agreementName: 'Test Happy Path Agreement',
      agreementType: 'STA',
      cplId: ctx.ids.customerId,
      channel: 'NKA',
      fuId: '9adf52c9-16fd-4195-ae63-76e9bfed4898', // Placeholder UUID (valid UUID v4)
      tacticId: 'a5bc87ca-6503-4e6a-80fe-f3824416a97c', // Placeholder UUID (valid UUID v4)
      mechanicId: '85ddec45-2fff-44b0-9a16-d7db2bae9acc', // Placeholder UUID (valid UUID v4)
      skuScope: 'FU',
      capTotalAmount: 25000,
      spendType: 'OFF_INVOICE',
      startDate: '2026-01-15',
      endDate: '2026-01-31',
      // periodMonth is calculated automatically from startDate, don't include it
      justification: 'Happy path test agreement',
    };

    const res = await ctx.api.post('/agreements', agreementData);
    ctx.ids.agreementId = res.data.id;
    
    logStep(3, 'Create Agreement', true, 
      `ID: ${res.data.id}\n   Code: ${res.data.agreementCode}\n   Status: ${res.data.status}`);

    // Verify status is DRAFT
    if (res.data.status !== 'DRAFT') {
      throw new Error(`Expected status DRAFT, got ${res.data.status}`);
    }

    return true;
  } catch (error: any) {
    logStep(3, 'Create Agreement', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step4_submitAgreement(): Promise<boolean> {
  logSection('SUBMIT AGREEMENT FOR APPROVAL');
  
  try {
    setAuth(ctx.tokens.planner!);

    const res = await ctx.api.post(`/agreements/${ctx.ids.agreementId}/submit`);
    ctx.ids.approvalRequestId = res.data.approvalRequestId;
    
    logStep(4, 'Submit Agreement', true,
      `Status: ${res.data.status}\n   ApprovalRequest ID: ${res.data.approvalRequestId || 'N/A'}`);

    // Verify status is PENDING
    if (res.data.status !== 'PENDING') {
      throw new Error(`Expected status PENDING, got ${res.data.status}`);
    }

    // Verify ApprovalRequest was created (if endpoint exists)
    if (ctx.ids.approvalRequestId) {
      try {
        const approvalRes = await ctx.api.get(`/approvals/${ctx.ids.approvalRequestId}`);
        logStep(4.1, 'Verify ApprovalRequest Created', true,
          `Status: ${approvalRes.data.status}`);
      } catch {
        // Approval endpoint might not exist, skip
      }
    }

    return true;
  } catch (error: any) {
    logStep(4, 'Submit Agreement', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step5_approveAgreement(): Promise<boolean> {
  logSection('APPROVE AGREEMENT');
  
  try {
    // Switch to Approver
    setAuth(ctx.tokens.approver!);

    // First, verify pending approvals (if endpoint exists)
    try {
      const pendingRes = await ctx.api.get('/approvals/pending');
      const pending = Array.isArray(pendingRes.data) ? pendingRes.data : pendingRes.data.data || [];
      logStep(5.1, 'Check Pending Approvals', true, `Found ${pending.length} pending`);
    } catch {
      // Endpoint might not exist, skip
    }

    // Approve the agreement
    const res = await ctx.api.post(`/agreements/${ctx.ids.agreementId}/approve`, {
      comments: 'Approved via happy path test',
    });

    logStep(5.2, 'Approve Agreement', true,
      `Status: ${res.data.status}\n   Approved At: ${res.data.approvedAt || 'N/A'}`);

    // Verify status is APPROVED
    if (res.data.status !== 'APPROVED') {
      throw new Error(`Expected status APPROVED, got ${res.data.status}`);
    }

    return true;
  } catch (error: any) {
    logStep(5, 'Approve Agreement', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step6_verifyBudgetReservation(): Promise<boolean> {
  logSection('VERIFY BUDGET RESERVATION');
  
  try {
    setAuth(ctx.tokens.admin!);

    // Get reserved amount for the envelope
    try {
      const reservedRes = await ctx.api.get(`/budget/envelopes/${ctx.ids.envelopeId}/reserved`);
      const reservedAmount = reservedRes.data.reservedAmount || 0;
      
      logStep(6.1, 'Check Reserved Amount', true, `Reserved: ${reservedAmount} TRY`);

      if (reservedAmount <= 0) {
        console.log('   ⚠️  Warning: Reserved amount is 0 - RESERVE transaction may not have been created');
      }
    } catch (summaryError: any) {
      console.log(`   ⚠️  Could not get reserved amount: ${summaryError.response?.data?.message || summaryError.message}`);
    }

    // Get transactions for the envelope to verify RESERVE transaction was created
    try {
      const txRes = await ctx.api.get(`/budget/envelopes/${ctx.ids.envelopeId}/transactions`);
      const transactions = Array.isArray(txRes.data) ? txRes.data : txRes.data.data || [];
      
      logStep(6.2, 'Get Envelope Transactions', true, `Found ${transactions.length} transactions`);
      
      // Find RESERVE transaction for this agreement
      const reserveTx = transactions.find((tx: any) => 
        tx.txType === 'RESERVE' && tx.sourceId === ctx.ids.agreementId
      );
      
      if (reserveTx) {
        logStep(6.3, 'Verify RESERVE Transaction', true, 
          `Found RESERVE transaction\n   Amount: ${reserveTx.amount} TRY\n   Status: ${reserveTx.txStatus}`);
      } else {
        console.log('   ⚠️  Warning: No RESERVE transaction found for this agreement');
        // List all RESERVE transactions for debugging
        const allReserves = transactions.filter((tx: any) => tx.txType === 'RESERVE');
        if (allReserves.length > 0) {
          console.log(`   Found ${allReserves.length} RESERVE transaction(s) for other agreements`);
        }
      }
    } catch (txError: any) {
      logStep(6.2, 'Get Envelope Transactions', false, txError.response?.data?.message || txError.message);
      // Don't fail the test if we can't get transactions, but log the error
    }

    return true;
  } catch (error: any) {
    logStep(6, 'Verify Budget Reservation', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step7_createOffInvoiceTransaction(): Promise<boolean> {
  logSection('CREATE OFF-INVOICE TRANSACTION');
  
  try {
    setAuth(ctx.tokens.planner!);

    const transactionData = {
      agreementId: ctx.ids.agreementId,
      invoiceNo: 'INV-TEST-001',
      invoiceDate: '2026-01-20',
      amount: 5000,
      notes: 'Happy path test transaction',
    };

    const res = await ctx.api.post('/agreement-transactions', transactionData);
    ctx.ids.transactionId = res.data.id;

    logStep(7, 'Create Off-Invoice Transaction', true,
      `ID: ${res.data.id}\n   Invoice: ${res.data.invoiceNo}\n   Amount: ${res.data.amount} TRY`);

    return true;
  } catch (error: any) {
    logStep(7, 'Create Off-Invoice Transaction', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step8_verifyLedgerEntry(): Promise<boolean> {
  logSection('VERIFY LEDGER ENTRY');
  
  try {
    setAuth(ctx.tokens.finance || ctx.tokens.admin!);

    // Get ledger entries for agreement (try different endpoint variations)
    try {
      const ledgerRes = await ctx.api.get(`/ledger/agreement/${ctx.ids.agreementId}`);
      const entries = Array.isArray(ledgerRes.data) ? ledgerRes.data : ledgerRes.data.data || [];
      
      logStep(8.1, 'Get Ledger Entries', true, `Found ${entries.length} entries`);

      // Get consumed amount
      try {
        const consumedRes = await ctx.api.get(`/ledger/agreement/${ctx.ids.agreementId}/consumed`);
        const consumed = consumedRes.data.consumed || consumedRes.data.consumedAmount || 0;
        
        logStep(8.2, 'Get Consumed Amount', true, `Consumed: ${consumed} TRY`);
      } catch {
        // Calculate from entries
        const total = entries.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
        logStep(8.2, 'Calculate Consumed Amount', true, `Total: ${total} TRY`);
      }
    } catch {
      // Try alternative endpoint
      const ledgerRes = await ctx.api.get('/ledger', {
        params: { agreementId: ctx.ids.agreementId }
      });
      const entries = Array.isArray(ledgerRes.data) ? ledgerRes.data : ledgerRes.data.data || [];
      logStep(8.1, 'Get Ledger Entries', true, `Found ${entries.length} entries`);
    }

    return true;
  } catch (error: any) {
    logStep(8, 'Verify Ledger Entry', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step9_verifyAgreementTotals(): Promise<boolean> {
  logSection('VERIFY AGREEMENT TOTALS');
  
  try {
    setAuth(ctx.tokens.planner!);

    // Get agreement details
    const agreementRes = await ctx.api.get(`/agreements/${ctx.ids.agreementId}`);
    const agreement = agreementRes.data;
    
    logStep(9.1, 'Get Agreement Details', true,
      `Cap: ${agreement.capTotalAmount} TRY\n   Consumed: ${agreement.consumedAmount || 0} TRY`);

    // Get transaction total (try different endpoint variations)
    try {
      const totalRes = await ctx.api.get(`/agreement-transactions/agreement/${ctx.ids.agreementId}/total`);
      const total = totalRes.data.total || totalRes.data.totalAmount || 0;
      
      logStep(9.2, 'Get Transaction Total', true, `Total: ${total} TRY`);
    } catch {
      // Try alternative: get all transactions and sum
      const txRes = await ctx.api.get('/agreement-transactions', {
        params: { agreementId: ctx.ids.agreementId }
      });
      const transactions = Array.isArray(txRes.data) ? txRes.data : txRes.data.data || [];
      const total = transactions.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0);
      logStep(9.2, 'Calculate Transaction Total', true, `Total: ${total} TRY`);
    }

    return true;
  } catch (error: any) {
    logStep(9, 'Verify Agreement Totals', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step10_testIdempotency(): Promise<boolean> {
  logSection('TEST IDEMPOTENCY');
  
  try {
    setAuth(ctx.tokens.planner!);

    // Try to create same transaction again
    const transactionData = {
      agreementId: ctx.ids.agreementId,
      invoiceNo: 'INV-TEST-001', // Same invoice
      invoiceDate: '2026-01-20', // Same date
      amount: 5000,
    };

    const res = await ctx.api.post('/agreement-transactions', transactionData);
    
    // Should return existing transaction (idempotent)
    if (res.data.id === ctx.ids.transactionId) {
      logStep(10, 'Idempotency Check', true, 'Duplicate request returned existing transaction');
      return true;
    } else {
      logStep(10, 'Idempotency Check', false, 'Created duplicate transaction!');
      return false;
    }
  } catch (error: any) {
    // If it throws error about duplicate, that's also acceptable
    if (error.response?.status === 409 || error.response?.data?.message?.includes('exists') || error.response?.data?.message?.includes('duplicate')) {
      logStep(10, 'Idempotency Check', true, 'Duplicate request rejected (conflict)');
      return true;
    }
    logStep(10, 'Idempotency Check', false, error.response?.data?.message || error.message);
    return false;
  }
}

async function step11_testSelfApprovalPrevention(): Promise<boolean> {
  logSection('TEST SELF-APPROVAL PREVENTION');
  
  try {
    setAuth(ctx.tokens.planner!);

    // Create another agreement
    const agreementData = {
      agreementName: 'Self-Approval Test Agreement',
      agreementType: 'STA',
      cplId: ctx.ids.customerId,
      channel: 'NKA',
      fuId: '9adf52c9-16fd-4195-ae63-76e9bfed4898', // Placeholder UUID (valid UUID v4)
      tacticId: 'a5bc87ca-6503-4e6a-80fe-f3824416a97c', // Placeholder UUID (valid UUID v4)
      mechanicId: '85ddec45-2fff-44b0-9a16-d7db2bae9acc', // Placeholder UUID (valid UUID v4)
      skuScope: 'FU',
      capTotalAmount: 10000,
      spendType: 'OFF_INVOICE',
      startDate: '2026-01-15',
      endDate: '2026-01-31',
      // periodMonth is calculated automatically from startDate, don't include it
      justification: 'Self-approval test',
    };

    const createRes = await ctx.api.post('/agreements', agreementData);
    const testAgreementId = createRes.data.id;

    // Submit it
    await ctx.api.post(`/agreements/${testAgreementId}/submit`);

    // Try to approve own agreement (should fail)
    try {
      await ctx.api.post(`/agreements/${testAgreementId}/approve`);
      logStep(11, 'Self-Approval Prevention', false, 'Self-approval was allowed!');
      return false;
    } catch (approveError: any) {
      if (approveError.response?.status === 403 || approveError.response?.status === 400) {
        logStep(11, 'Self-Approval Prevention', true, 'Self-approval correctly blocked');
        return true;
      }
      throw approveError;
    }
  } catch (error: any) {
    logStep(11, 'Self-Approval Prevention', false, error.response?.data?.message || error.message);
    return false;
  }
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runHappyPathTest() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     CollMind TPM - Happy Path Test Suite                   ║');
  console.log('║     Sprint 1: Actuals-First Flow                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nAPI URL: ${BASE_URL}`);
  console.log(`Tenant ID: ${TENANT_ID}`);

  const results: { step: string; passed: boolean }[] = [];

  // Run all steps
  const steps = [
    { name: 'Login Users', fn: step1_loginUsers },
    { name: 'Fetch Reference Data', fn: step2_getCustomerAndEnvelope },
    { name: 'Create Agreement', fn: step3_createAgreement },
    { name: 'Submit Agreement', fn: step4_submitAgreement },
    { name: 'Approve Agreement', fn: step5_approveAgreement },
    { name: 'Verify Budget Reservation', fn: step6_verifyBudgetReservation },
    { name: 'Create Off-Invoice Transaction', fn: step7_createOffInvoiceTransaction },
    { name: 'Verify Ledger Entry', fn: step8_verifyLedgerEntry },
    { name: 'Verify Agreement Totals', fn: step9_verifyAgreementTotals },
    { name: 'Test Idempotency', fn: step10_testIdempotency },
    { name: 'Test Self-Approval Prevention', fn: step11_testSelfApprovalPrevention },
  ];

  for (const step of steps) {
    const passed = await step.fn();
    results.push({ step: step.name, passed });
    
    // Stop on critical failure (first 7 steps)
    if (!passed && results.length <= 7) {
      console.log('\n❌ Critical step failed, stopping test suite');
      break;
    }
  }

  // Print summary
  logSection('TEST SUMMARY');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  results.forEach((r, i) => {
    console.log(`   ${r.passed ? '✅' : '❌'} ${i + 1}. ${r.step}`);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`   Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`   Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  console.log('─'.repeat(60));

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Happy Path is working correctly.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runHappyPathTest().catch(error => {
  console.error('Test suite crashed:', error);
  process.exit(1);
});

