import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // ADIM 3 Faz A (0072 §0/4b): bilinçli-açık uç — hiç JwtAuthGuard taşımıyor,
  // @Public() burada yalnız işaret (login/refresh'teki aynı gerekçe).
  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  getHello(): string {
    return this.appService.getHello();
  }
}
