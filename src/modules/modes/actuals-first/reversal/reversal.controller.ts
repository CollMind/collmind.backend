import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { ReversalService } from './reversal.service';
import { ReversalGuard } from './reversal.guard';
import { ReverseTransactionDto, ReversalResponseDto } from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';

@ApiTags('Reversals (Actuals-First)')
@ApiBearerAuth()
@Controller('actuals-first/reversals')
@UseGuards(JwtAuthGuard, ReversalGuard)
export class ReversalController {
  constructor(private readonly reversalService: ReversalService) {}

  /**
   * POST /actuals-first/reversals/agreement-transaction/:transactionId
   *
   * Bir off-invoice agreement transaction'ını geri alır.
   * Yalnızca ADMIN veya CATEGORY_MANAGER rolü.
   */
  @Post('agreement-transaction/:transactionId')
  @ApiOperation({
    summary: 'Reverse an off-invoice agreement transaction',
    description:
      'Creates a reversal (credit) ledger entry, marks the original as reversed, ' +
      'releases budget, and logs the action in the immutable audit trail. ' +
      'Requires ADMIN or CATEGORY_MANAGER role.',
  })
  @ApiParam({ name: 'transactionId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReversalResponseDto })
  @ApiResponse({ status: 403, description: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY' })
  @ApiResponse({ status: 404, description: 'Agreement transaction not found' })
  @ApiResponse({
    status: 409,
    description:
      'ALREADY_REVERSED | NOT_REVERSIBLE_STATE | REVERSAL_SOURCE_NOT_FOUND',
  })
  async reverseTransaction(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: ReverseTransactionDto,
  ): Promise<ReversalResponseDto> {
    return this.reversalService.reverseTransaction(
      transactionId,
      tenantId,
      user.id,
      user.email,
      dto,
    );
  }
}
