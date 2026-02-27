import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully', type: UserResponseDto })
  create(@TenantId() tenantId: string, @Body() createUserDto: CreateUserDto) {
    return this.userService.create(tenantId, createUserDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users', type: [UserResponseDto] })
  findAll(@TenantId() tenantId: string) {
    return this.userService.findAll(tenantId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile', type: UserResponseDto })
  getProfile(@Request() req: any) {
    return this.userService.getProfile(req.user.tenantId, req.user.sub);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated', type: UserResponseDto })
  updateProfile(
    @Request() req: any,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    // Prevent role escalation - users cannot change their own role
    if (updateUserDto.role) {
      delete updateUserDto.role;
    }
    return this.userService.update(req.user.tenantId, req.user.sub, updateUserDto, user.id, user.role);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 204, description: 'Password changed successfully' })
  changeMyPassword(@Request() req: any, @Body() changePasswordDto: ChangePasswordDto) {
    return this.userService.changePassword(req.user.tenantId, req.user.sub, changePasswordDto);
  }

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Get dashboard summary for current user' })
  @ApiResponse({ status: 200, description: 'Dashboard summary data' })
  getDashboardSummary(@TenantId() tenantId: string) {
    return this.userService.getDashboardSummary(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details', type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.userService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user (EA-001: Admin restrictions apply)' })
  @ApiResponse({ status: 200, description: 'User updated successfully', type: UserResponseDto })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.userService.update(tenantId, id, updateUserDto, user.id, user.role);
  }

  @Patch(':id/password')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 204, description: 'Password changed successfully' })
  changePassword(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(tenantId, id, changePasswordDto);
  }

  @Post(':id/activate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate user' })
  @ApiResponse({ status: 200, description: 'User activated' })
  activate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.userService.activate(tenantId, id);
  }

  @Post(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  deactivate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.userService.deactivate(tenantId, id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 204, description: 'User deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.userService.remove(tenantId, id);
  }
}

