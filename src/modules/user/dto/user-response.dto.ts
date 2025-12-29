import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../../database/entities/user.entity';

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  firstName?: string;

  @ApiProperty()
  lastName?: string;

  @ApiProperty()
  phoneNumber?: string;

  @ApiProperty()
  department?: string;

  @ApiProperty()
  jobTitle?: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  lastLoginAt?: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

