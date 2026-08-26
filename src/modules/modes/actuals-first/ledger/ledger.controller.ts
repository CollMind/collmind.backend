import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../../common/guards/capability.guard';
import { RequireCapability } from '../../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../../common/authorization/capabilities';
import { TenantId } from '../../../../common/decorators/tenant.decorator';

// `Z42 §4` (`B3b-1 W9`, 2026-08-26) — defter-okuma kümesi ({A,F,P}) YENİ
// hücre `MODES_LEDGER_READ`'e göçürüldü. `@Roles` → `@RequireCapability`;
// `ROLE_CAPABILITIES`'te hücre göç öncesi `{ADMIN,FINANCE,PLANNER}` kümesiyle
// BİREBİR — davranış KORUNUYOR (pin: `test/ledger-envelope-role-boundary.
// e2e-spec.ts`, `B3` kaza-dalgası `K2` normalizasyonundan sonraki hâl).
@ApiTags('Ledger')
@ApiBearerAuth()
@Controller('ledger')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get all ledger entries' })
  findAll(
    @TenantId() tenantId: string,
    @Query('agreementId') agreementId?: string,
    @Query('budgetEnvelopeId') budgetEnvelopeId?: string,
    @Query('periodMonth') periodMonth?: string,
    @Query('spendType') spendType?: string,
  ) {
    return this.ledgerService.findAll(tenantId, {
      agreementId,
      budgetEnvelopeId,
      periodMonth,
      spendType,
    });
  }

  @Get('agreement/:agreementId')
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get ledger entries by agreement ID' })
  findByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findByAgreementId(agreementId, tenantId);
  }

  @Get('agreement/:agreementId/consumed')
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get total consumed amount for agreement' })
  async getConsumedByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    const consumed = await this.ledgerService.getConsumedByAgreement(
      agreementId,
      tenantId,
    );
    return { agreementId, consumed };
  }

  // `B3` kaza-dalgası `K2` (2026-08-26) — normalizasyon, kayıtsız fark.
  // Kardeş rotalar (`ledger` · `ledger/:id` · `ledger/agreement/:id(/consumed)`)
  // hepsi `{ADMIN,FINANCE,PLANNER}`; bu iki `envelope/*` rotası `{ADMIN,FINANCE}`
  // kalmıştı. `ledger.repository.ts`: `findByEnvelopeId` ile `findAll`'un
  // `budgetEnvelopeId` filtresi AYNI yüklem — yani PLANNER bu veriye
  // `GET /ledger?budgetEnvelopeId=X` üzerinden zaten erişebiliyordu; kısıt
  // fiilen bir BYPASS'tı. Kayıt taraması: `git log -L <aralık>:<dosya>   (⚠️ `-S 'envelope/:envelopeId'` YETMEZ: rota
  //   DİZGESİNİN doğuşunu/ölümünü tarar, yalnız `@Roles` satırını değiştiren bir
  //   commit'i GÖRMEZ — code-reviewer S4)`
  // → tek sonuç dosyanın doğuş commit'i, gerekçeli bir istisna kaydı yok.
  // Pin: `test/ledger-envelope-role-boundary.e2e-spec.ts`.
  @Get('envelope/:envelopeId')
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get ledger entries by budget envelope ID' })
  findByEnvelope(
    @Param('envelopeId', ParseUUIDPipe) envelopeId: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findByEnvelopeId(envelopeId, tenantId);
  }

  // `B3` kaza-dalgası `K2` — yukarıdaki `envelope/:envelopeId` notuyla aynı
  // gerekçe; kardeş `agreement/:agreementId/consumed` zaten `{ADMIN,FINANCE,
  // PLANNER}`.
  @Get('envelope/:envelopeId/consumed')
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get total consumed amount for budget envelope' })
  async getConsumedByEnvelope(
    @Param('envelopeId', ParseUUIDPipe) envelopeId: string,
    @TenantId() tenantId: string,
  ) {
    const consumed = await this.ledgerService.getConsumedByEnvelope(
      envelopeId,
      tenantId,
    );
    return { envelopeId, consumed };
  }

  @Get(':id')
  @RequireCapability(CAPABILITIES.MODES_LEDGER_READ)
  @ApiOperation({ summary: 'Get ledger entry by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findById(id, tenantId);
  }
}
