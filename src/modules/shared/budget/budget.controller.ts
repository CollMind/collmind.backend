import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BudgetService } from './budget.service';
import { CreateBudgetEnvelopeDto } from './dto/create-budget-envelope.dto';
import { SplitBudgetEnvelopeDto } from './dto/split-budget-envelope.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Budget')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  // `B3 W4b` göçü (2026-08-26, `Z36` SINIF B): `@Roles(ADMIN,FINANCE)` →
  // `@RequireCapability(SHARED_ENVELOPE_WRITE)`. `ROLE_CAPABILITIES`'te
  // `SHARED_ENVELOPE_WRITE` aynı iki role — davranış BİREBİR korunuyor.
  // Gerekçe: `K-2.2.9c` "finans zarfı büyütür … kararı paranın sahibine
  // taşır" — YAZAN FINANCE, ONAYLAYAN zarf sahibi (CM, ayrı kanal/onay).
  @Post('envelopes')
  @RequireCapability(CAPABILITIES.SHARED_ENVELOPE_WRITE)
  @ApiOperation({ summary: 'Create a new budget envelope' })
  @ApiResponse({
    status: 201,
    description: 'Budget envelope created successfully',
  })
  createEnvelope(
    @TenantId() tenantId: string,
    @Body() createDto: CreateBudgetEnvelopeDto,
  ) {
    return this.budgetService.createEnvelope(tenantId, createDto);
  }

  // T-267 (B1 §S3 final karar, ürün sahibi 2026-08-21) — BEŞ ROL, union
  // DEĞİL, her rol için K-2.6.4'ten ayrı cümle:
  //   YÖNETİCİ: tanım gereği
  //   FİNANS: "eşik üstü onay · transfer · mutabakat" — zarf BAKİYESİNİ
  //     görmeden yapamaz
  //   KATEGORİ MÜDÜRÜ: "kategori bütçe sahibi" — kendi zarfını görmek
  //     TANIMSAL
  //   PLANLAMACI: POST /budget/reserve'de ZATEN VAR (kardeş uç, satır 69)
  //     — yazabildiği bir zarfı okuyamaması TUTARSIZ olurdu
  //   İZLEYİCİ: "salt görüntüleme" — bütçe durumu izlemenin ÇEKİRDEĞİ
  // ⚠️ KAPSAM SÜTUNU ❌ — resolveScope/AccessScope bu serviste 0 atıf
  // (ölçüldü). Bir CATEGORY_MANAGER başka kategorinin zarfını görebilir.
  // Bu B2'nin kapsamı DIŞINDA — [[T-253]]/[[T-254]], KAPSAM RATCHET'ine
  // (Z19b, [[T-266]]) girer, scope-a1-baseline.txt'e BURADA DOKUNULMADI.
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  // ⚠️ KAPSAM SÜTUNU hâlâ ❌ (yukarıdaki `T-267` notu) — bu göç yalnız ROL
  // katmanını taşıyor, kapsam işi ayrı (`[[T-266]]`).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('envelopes')
  @ApiOperation({ summary: 'Get all budget envelopes' })
  @ApiResponse({ status: 200, description: 'List of budget envelopes' })
  findAllEnvelopes(@TenantId() tenantId: string) {
    return this.budgetService.findAllEnvelopes(tenantId);
  }

  // T-267 (B1 §S3) — aynı gerekçe (yukarı bkz., BEŞ ROL) — kapsam ❌ aynı
  // şekilde bu turun dışında.
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  // ⚠️ KAPSAM SÜTUNU hâlâ ❌ (yukarıdaki `T-267` notu) — bu göç yalnız ROL
  // katmanını taşıyor, kapsam işi ayrı (`[[T-266]]`).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('envelopes/:id')
  @ApiOperation({ summary: 'Get budget envelope by ID' })
  @ApiResponse({ status: 200, description: 'Budget envelope details' })
  findEnvelopeById(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.budgetService.findEnvelopeById(tenantId, id);
  }

  // `POST /budget/reserve` (`reserveBudget`) KALDIRILDI (T-289, `Z38`,
  // `B3` kaza-dalgası `K6(c)`, 2026-08-26). Kanonik motor
  // `reserveForAgreement` (agreement onayından, `agreement.service.ts:750`)
  // ve `reserveTypedForPlan` (plan onayından) tek yoldur — bkz.
  // `test/budget-reserve-canonical-path.e2e-spec.ts`. Kaldırma gerekçesi:
  //   (1) K-2.2.4'ün ("Rezerve ANLAŞMA ONAYLANDIĞINDA dolar") tetikleyicisini
  //       ATLAYAN doğrulanmamış ikinci bir yazma yolu (yapısal),
  //   (2) uç yapısal olarak KIRIK ve ÖLÜ — `findEnvelopeWithLock`
  //       transaction'sız çağrılıyor, `setLock('pessimistic_write')` HER
  //       ÇAĞRIDA `PessimisticLockTransactionRequiredError` ile 500 veriyor
  //       (repro-pin, T-289 `F12`/`Z38 §1`),
  //   (3) defter taraması: bu yolla doğmuş satır SIFIR (`budget_transactions`,
  //       T-289 `K6(b)`) — `ADR-0012` devreye girmedi, fiziksel silme yok.
  // `§7.1` çağıran taraması: `reserveBudget`'ın (bu servis metodu) tek
  // çağıranı kaldırılan bu route'tu; başka üretim çağıranı YOK (grep,
  // T-289 raporu). `budgetService.reserveBudget` metodu da bu adımda
  // silindi.

  // T-267 (B1 §S3) — aynı gerekçe (yukarı bkz., BEŞ ROL) — kapsam ❌ aynı
  // şekilde bu turun dışında.
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  // ⚠️ KAPSAM SÜTUNU hâlâ ❌ (yukarıdaki `T-267` notu) — bu göç yalnız ROL
  // katmanını taşıyor, kapsam işi ayrı (`[[T-266]]`).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('envelopes/:id/reserved')
  @ApiOperation({
    summary: 'Get reserved amount for an envelope (computed from transactions)',
  })
  @ApiResponse({ status: 200, description: 'Reserved amount' })
  async getReservedAmount(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const amount = await this.budgetService.getReservedAmount(tenantId, id);
    return { envelopeId: id, reservedAmount: amount };
  }

  // `B3 W4b` göçü (2026-08-26, `Z36` SINIF B): `@Roles(ADMIN,FINANCE)` →
  // `@RequireCapability(SHARED_ENVELOPE_WRITE)`. Aynı gerekçe (yukarı,
  // `createEnvelope` bkz.) — split de zarf-YAPISI kararı.
  @Post('envelopes/:id/split')
  @RequireCapability(CAPABILITIES.SHARED_ENVELOPE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'T-019b (Faz 2): split an UNSPLIT legacy envelope into ON_INVOICE/OFF_INVOICE twins ' +
      '(Finance ownership, BRD §8). Amounts must sum to the current allocated_amount. ' +
      'Any OFF_INVOICE-tagged encumbrance is re-homed append-only (RELEASE+RESERVE/COMMIT).',
  })
  @ApiResponse({ status: 201, description: 'Envelope split successfully' })
  @ApiResponse({
    status: 400,
    description:
      'Amounts do not sum to allocated_amount, or AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED',
  })
  @ApiResponse({
    status: 409,
    description: 'Envelope already split, or UNTYPED_ENCUMBRANCE_PRESENT',
  })
  async splitEnvelope(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() splitDto: SplitBudgetEnvelopeDto,
  ) {
    return this.budgetService.splitEnvelope(
      tenantId,
      user.id,
      id,
      splitDto.onInvoiceAllocated,
      splitDto.offInvoiceAllocated,
    );
  }

  // T-267 (B1 §S3) — aynı gerekçe (yukarı bkz., BEŞ ROL) — kapsam ❌ aynı
  // şekilde bu turun dışında.
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  // ⚠️ KAPSAM SÜTUNU hâlâ ❌ (yukarıdaki `T-267` notu) — bu göç yalnız ROL
  // katmanını taşıyor, kapsam işi ayrı (`[[T-266]]`).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('envelopes/:id/transactions')
  @ApiOperation({ summary: 'Get all transactions for an envelope' })
  @ApiResponse({ status: 200, description: 'List of transactions' })
  getTransactionsByEnvelope(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.budgetService.getTransactionsByEnvelope(tenantId, id);
  }

  // T-267 (B1 §S3) — aynı gerekçe (yukarı bkz., BEŞ ROL) — kapsam ❌ aynı
  // şekilde bu turun dışında.
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  // ⚠️ KAPSAM SÜTUNU hâlâ ❌ (yukarıdaki `T-267` notu) — bu göç yalnız ROL
  // katmanını taşıyor, kapsam işi ayrı (`[[T-266]]`).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('status')
  @ApiOperation({ summary: 'Get budget status for channel and category' })
  @ApiResponse({
    status: 200,
    description: 'Budget status with available and planned amounts',
  })
  async getBudgetStatus(
    @TenantId() tenantId: string,
    @Query('channel') channel: string,
    @Query('categoryId') categoryId?: string,
    @Query('periodMonth') periodMonth?: string,
  ) {
    return this.budgetService.getBudgetStatus(
      tenantId,
      channel,
      categoryId,
      periodMonth,
    );
  }
}
