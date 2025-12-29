import { IsEmail, IsString, IsOptional, IsIP } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john.doe@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: '192.168.1.1', description: 'Client IP address' })
  @IsOptional()
  @IsIP()
  ipAddress?: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty()
  user!: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
  };
}

