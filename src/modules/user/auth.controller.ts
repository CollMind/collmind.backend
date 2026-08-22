import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly userService: UserService) {}

  // ADIM 3 Faz A (0072 §0/4b): bilinçli-açık uç — hiç JwtAuthGuard taşımıyor,
  // @Public() burada yalnız işaret; guard'ın kendisi bu uçta hiç koşmuyor.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: any,
  ): Promise<LoginResponseDto> {
    // Try to get tenantId from header, otherwise find user by email to get tenantId
    let tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      // Find user by email to get tenantId
      const user = await this.userService.findByEmailWithoutTenant(
        loginDto.email,
      );
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }
      tenantId = user.tenantId;
    }

    return this.userService.login(tenantId, loginDto);
  }

  // ADIM 3 Faz A (0072 §0/4b): bilinçli-açık uç — aynı gerekçe (login'e bkz.).
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed',
    type: LoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(
    @Body('refreshToken') refreshToken: string,
  ): Promise<LoginResponseDto> {
    return this.userService.refreshToken(refreshToken);
  }

  // T-267 (B1 §1g, ölçüldü 2026-08-21: koşum yapıldı, izolasyon tutuyor) —
  // self-action: her kimliklenmiş kullanıcı KENDİ oturumunu (req.user.sub,
  // JWT'den) sonlandırır. `/users/me` (§1d) gibi rol kısıtı GEREKMEZDİ, ama
  // bu turun talimatı yalnız §1d'yi @Roles'suz bırakıyor — bu yüzden TÜM
  // roller açıkça sayıldı (union DEĞİL: bir rolü çıkarmak o rolün
  // kullanıcılarının çıkış yapamaması demektir — Z18 testi). RolesGuard
  // route-seviyesine EKLENDİ, yoksa @Roles İNERT kalır (roles.guard.ts).
  @Post('logout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ status: 204, description: 'Logout successful' })
  async logout(@Request() req: any): Promise<void> {
    return this.userService.logout(req.user.tenantId, req.user.sub);
  }
}
