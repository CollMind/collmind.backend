import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveRequestDto {
  @ApiPropertyOptional({ description: 'Optional approval comments' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}

export class RejectRequestDto {
  @ApiProperty({ description: 'Rejection reason (required)' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
