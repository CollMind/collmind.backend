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
import { ReserveBudgetDto } from './dto/reserve-budget.dto';
import { SplitBudgetEnvelopeDto } from './dto/split-budget-envelope.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';

@ApiTags('Budget')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Post('envelopes')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
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

  @Get('envelopes')
  @ApiOperation({ summary: 'Get all budget envelopes' })
  @ApiResponse({ status: 200, description: 'List of budget envelopes' })
  findAllEnvelopes(@TenantId() tenantId: string) {
    return this.budgetService.findAllEnvelopes(tenantId);
  }

  @Get('envelopes/:id')
  @ApiOperation({ summary: 'Get budget envelope by ID' })
  @ApiResponse({ status: 200, description: 'Budget envelope details' })
  findEnvelopeById(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.budgetService.findEnvelopeById(tenantId, id);
  }

  @Post('reserve')
  @Roles(UserRole.PLANNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Reserve budget from an envelope (Event-sourced: creates RESERVE transaction)',
  })
  @ApiResponse({ status: 201, description: 'Budget reserved successfully' })
  @ApiResponse({
    status: 400,
    description: 'Insufficient budget or invalid request',
  })
  async reserveBudget(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() reserveDto: ReserveBudgetDto,
  ) {
    return this.budgetService.reserveBudget(
      tenantId,
      user.id,
      reserveDto.agreementId,
      reserveDto.envelopeId,
      reserveDto.amount,
      reserveDto.currency || 'TRY',
    );
  }

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

  @Post('envelopes/:id/split')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
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

  @Get('envelopes/:id/transactions')
  @ApiOperation({ summary: 'Get all transactions for an envelope' })
  @ApiResponse({ status: 200, description: 'List of transactions' })
  getTransactionsByEnvelope(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.budgetService.getTransactionsByEnvelope(tenantId, id);
  }

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
