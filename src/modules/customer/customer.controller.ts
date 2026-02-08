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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

  @Get('cpl/list')
  @ApiOperation({ summary: 'Get CPL list with statistics (customer count, active agreements)' })
  @ApiResponse({ status: 200, description: 'CPL list with statistics' })
  getCplList(
    @TenantId() tenantId: string,
    @Query('channel') channel?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.customerService.getCplList(tenantId, channel, categoryId);
  }

  @Post('import')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Import customers from Excel or CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Excel (.xlsx, .xls) or CSV (.csv) file',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'At least one customer was created successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Total rows processed' },
        created: { type: 'number', description: 'Number of customers created' },
        skipped: { type: 'number', description: 'Number of customers skipped' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'number', description: 'Row number in file' },
              code: { type: 'string', description: 'Customer code' },
              error_type: { 
                type: 'string', 
                description: 'Error type: MISSING_FIELD, INVALID_DATE, INVALID_AMOUNT, ALREADY_EXISTS, DUPLICATE_IN_FILE, DATABASE_ERROR, INVALID_EMAIL',
                enum: ['MISSING_FIELD', 'INVALID_DATE', 'INVALID_AMOUNT', 'ALREADY_EXISTS', 'DUPLICATE_IN_FILE', 'DATABASE_ERROR', 'INVALID_EMAIL'],
              },
              error_message: { type: 'string', description: 'Human-readable error message' },
              original_row_data: { 
                type: 'object', 
                description: 'Original row data from file',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'No customers were created (all failed validation, already exist, or file processing error)',
  })
  async importFromFile(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: any,
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    // Security: File size validation to prevent DoS attacks (10MB max)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.');
    }

    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/csv',
    ];

    const allowedExtensions = ['xlsx', 'xls', 'csv'];

    // Security: Validate file extension
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        'Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
      );
    }

    // Security: Validate MIME type to prevent file type spoofing
    // Attackers can rename malicious files with valid extensions, so we must check MIME type
    if (!file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Geçersiz dosya tipi. Beklenen MIME tipleri: ${allowedMimeTypes.join(', ')}`,
      );
    }

    const result = await this.customerService.importFromFile(tenantId, file);

    // Return appropriate HTTP status based on actual outcome
    // 201 if at least one customer was created, 400 if none were created
    if (result.created > 0) {
      return res.status(HttpStatus.CREATED).json(result);
    } else {
      return res.status(HttpStatus.BAD_REQUEST).json(result);
    }
  }
}

