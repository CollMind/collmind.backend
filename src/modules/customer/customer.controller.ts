import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Create a new customer' })
  @ApiResponse({ status: 201, description: 'Customer created successfully', type: CustomerResponseDto })
  create(@TenantId() tenantId: string, @Body() createCustomerDto: CreateCustomerDto) {
    return this.customerService.create(tenantId, createCustomerDto);
  }

  @Post('bulk')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Create multiple customers' })
  @ApiResponse({ status: 201, description: 'Customers created successfully', type: [CustomerResponseDto] })
  createBulk(@TenantId() tenantId: string, @Body('customers') customers: CreateCustomerDto[]) {
    return this.customerService.createBulk(tenantId, customers);
  }

  @Get()
  @ApiOperation({ summary: 'Get all customers' })
  @ApiResponse({ status: 200, description: 'List of customers', type: [CustomerResponseDto] })
  findAll(@TenantId() tenantId: string, @Query() filters: CustomerFilterDto) {
    return this.customerService.findAll(tenantId, filters);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search customers' })
  @ApiResponse({ status: 200, description: 'Search results', type: [CustomerResponseDto] })
  search(@TenantId() tenantId: string, @Query('q') searchTerm: string) {
    return this.customerService.findAll(tenantId, { search: searchTerm } as CustomerFilterDto);
  }

  @Get('channel/:channel')
  @ApiOperation({ summary: 'Get customers by channel' })
  @ApiResponse({ status: 200, description: 'List of customers', type: [CustomerResponseDto] })
  findByChannel(@TenantId() tenantId: string, @Param('channel') channel: string) {
    return this.customerService.findByChannel(tenantId, channel);
  }

  @Get('city/:city')
  @ApiOperation({ summary: 'Get customers by city' })
  @ApiResponse({ status: 200, description: 'List of customers', type: [CustomerResponseDto] })
  findByCity(@TenantId() tenantId: string, @Param('city') city: string) {
    return this.customerService.findByCity(tenantId, city);
  }

  @Get('vip')
  @ApiOperation({ summary: 'Get VIP customers' })
  @ApiResponse({ status: 200, description: 'List of VIP customers', type: [CustomerResponseDto] })
  findVipCustomers(@TenantId() tenantId: string) {
    return this.customerService.findVipCustomers(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by ID' })
  @ApiResponse({ status: 200, description: 'Customer details', type: CustomerResponseDto })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customerService.findOne(tenantId, id);
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get customer by code' })
  @ApiResponse({ status: 200, description: 'Customer details', type: CustomerResponseDto })
  findByCode(@TenantId() tenantId: string, @Param('code') code: string) {
    return this.customerService.findByCode(tenantId, code);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update customer' })
  @ApiResponse({ status: 200, description: 'Customer updated successfully', type: CustomerResponseDto })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customerService.update(tenantId, id, updateCustomerDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete customer' })
  @ApiResponse({ status: 204, description: 'Customer deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customerService.remove(tenantId, id);
  }

  @Post(':id/activate')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Activate customer' })
  @ApiResponse({ status: 200, description: 'Customer activated' })
  activate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customerService.activate(tenantId, id);
  }

  @Post(':id/deactivate')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Deactivate customer' })
  @ApiResponse({ status: 200, description: 'Customer deactivated' })
  deactivate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customerService.deactivate(tenantId, id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get customer statistics' })
  @ApiResponse({ status: 200, description: 'Customer statistics' })
  getStats(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customerService.getStats(tenantId, id);
  }
}

