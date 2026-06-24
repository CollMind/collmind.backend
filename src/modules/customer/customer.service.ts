import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CustomerRepository } from './customer.repository';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import {
  Customer,
  CustomerStatus,
} from '../../database/entities/customer.entity';
import { FileParserService } from './services/file-parser.service';

@Injectable()
export class CustomerService {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly fileParserService: FileParserService,
  ) {}

  private convertDateFields(
    dto: CreateCustomerDto | UpdateCustomerDto,
  ): Partial<Customer> {
    const {
      lastOrderDate,
      firstOrderDate,
      contractStartDate,
      contractEndDate,
      ...rest
    } = dto;

    return {
      ...rest,
      ...(lastOrderDate && { lastOrderDate: new Date(lastOrderDate) }),
      ...(firstOrderDate && { firstOrderDate: new Date(firstOrderDate) }),
      ...(contractStartDate && {
        contractStartDate: new Date(contractStartDate),
      }),
      ...(contractEndDate && { contractEndDate: new Date(contractEndDate) }),
    };
  }

  async create(
    tenantId: string,
    createCustomerDto: CreateCustomerDto,
  ): Promise<Customer> {
    // Check if customer with same code exists
    const existing = await this.customerRepository.findByCode(
      tenantId,
      createCustomerDto.code,
    );
    if (existing) {
      throw new ConflictException('Customer with this code already exists');
    }

    const customer = this.customerRepository.create({
      ...this.convertDateFields(createCustomerDto),
      tenantId,
    });

    return this.customerRepository.save(customer);
  }

  async createBulk(
    tenantId: string,
    customers: CreateCustomerDto[],
  ): Promise<Customer[]> {
    const createdCustomers: Customer[] = [];

    for (const customerDto of customers) {
      const existing = await this.customerRepository.findByCode(
        tenantId,
        customerDto.code,
      );
      if (!existing) {
        const customer = this.customerRepository.create({
          ...this.convertDateFields(customerDto),
          tenantId,
        });
        createdCustomers.push(await this.customerRepository.save(customer));
      }
    }

    return createdCustomers;
  }

  async findAll(tenantId: string, filters?: CustomerFilterDto): Promise<any> {
    // Eğer filters varsa ve herhangi bir filtre değeri içeriyorsa findWithFilters kullan
    if (filters && this.hasActiveFilters(filters)) {
      return this.customerRepository.findWithFilters(tenantId, filters);
    }
    // Aksi halde tüm müşterileri getir (pagination olmadan)
    return this.customerRepository.findAllByTenant(tenantId);
  }

  private hasActiveFilters(filters: CustomerFilterDto): boolean {
    // Sadece pagination parametreleri varsa (page, limit, sortBy, sortOrder) filtre yok sayılır
    const hasFilterValues = !!(
      filters.channel ||
      filters.city ||
      filters.region ||
      filters.status ||
      filters.tier ||
      filters.isVip !== undefined ||
      filters.search
    );
    return hasFilterValues;
  }

  async findOne(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { tenantId, id },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async findByCode(tenantId: string, code: string): Promise<Customer> {
    const customer = await this.customerRepository.findByCode(tenantId, code);

    if (!customer) {
      throw new NotFoundException(`Customer with code ${code} not found`);
    }

    return customer;
  }

  async update(
    tenantId: string,
    id: string,
    updateCustomerDto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);

    // Check code uniqueness if changing
    if (updateCustomerDto.code && updateCustomerDto.code !== customer.code) {
      const existing = await this.customerRepository.findByCode(
        tenantId,
        updateCustomerDto.code,
      );
      if (existing) {
        throw new ConflictException('Customer with this code already exists');
      }
    }

    Object.assign(customer, this.convertDateFields(updateCustomerDto));
    return this.customerRepository.save(customer);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const customer = await this.findOne(tenantId, id);
    await this.customerRepository.softRemove(customer);
  }

  async activate(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    customer.status = CustomerStatus.ACTIVE;
    return this.customerRepository.save(customer);
  }

  async deactivate(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    customer.status = CustomerStatus.INACTIVE;
    return this.customerRepository.save(customer);
  }

  async findByChannel(tenantId: string, channel: string): Promise<Customer[]> {
    return this.customerRepository.findByChannel(tenantId, channel);
  }

  async findByChannelId(
    tenantId: string,
    channelId: string,
  ): Promise<Customer[]> {
    return this.customerRepository.findByChannelId(tenantId, channelId);
  }

  async findByCity(tenantId: string, city: string): Promise<Customer[]> {
    return this.customerRepository.findByCity(tenantId, city);
  }

  async findVipCustomers(tenantId: string): Promise<Customer[]> {
    return this.customerRepository.findVipCustomers(tenantId);
  }

  async getStats(tenantId: string, id: string): Promise<any> {
    const customer = await this.findOne(tenantId, id);

    return {
      customerId: customer.id,
      totalOrders: customer.totalOrders,
      lastOrderDate: customer.lastOrderDate,
      firstOrderDate: customer.firstOrderDate,
      annualRevenue: customer.annualRevenue,
    };
  }

  async importFromFile(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<{
    total: number;
    created: number;
    skipped: number;
    errors: Array<{
      row: number;
      code: string;
      error_type: string;
      error_message: string;
      original_row_data?: Record<string, any>;
    }>;
  }> {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    let customersWithRowNumbers: Array<{
      dto: CreateCustomerDto;
      originalRowNumber: number;
      originalRowData?: Record<string, any>;
    }>;

    try {
      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        customersWithRowNumbers = await this.fileParserService.parseExcel(file);
      } else if (fileExtension === 'csv') {
        customersWithRowNumbers = await this.fileParserService.parseCSV(file);
      } else {
        throw new BadRequestException(
          'Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Dosya işlenemedi: ${errorMessage}`);
    }

    if (!customersWithRowNumbers || customersWithRowNumbers.length === 0) {
      throw new BadRequestException(
        'Dosyada geçerli müşteri verisi bulunamadı',
      );
    }

    // AI-001: Validation runs on all rows BEFORE any insert
    const validationErrors: Array<{
      row: number;
      code: string;
      error_type: string;
      error_message: string;
      original_row_data?: Record<string, any>;
    }> = [];

    const validCustomers: Array<{
      dto: CreateCustomerDto;
      originalRowNumber: number;
      originalRowData?: Record<string, any>;
    }> = [];

    // Step 1: Validate all rows
    for (const {
      dto: customerDto,
      originalRowNumber,
      originalRowData,
    } of customersWithRowNumbers) {
      const validationError = this.validateCustomerDto(
        customerDto,
        originalRowNumber,
      );
      if (validationError) {
        validationErrors.push({
          ...validationError,
          original_row_data: originalRowData || this.dtoToRecord(customerDto),
        });
      } else {
        validCustomers.push({
          dto: customerDto,
          originalRowNumber,
          originalRowData,
        });
      }
    }

    // Edge case: All rows invalid
    if (validCustomers.length === 0) {
      return {
        total: customersWithRowNumbers.length,
        created: 0,
        skipped: customersWithRowNumbers.length,
        errors: validationErrors,
      };
    }

    // Step 2: Check for duplicates in valid rows
    const seenCodes = new Set<string>();
    const duplicateErrors: typeof validationErrors = [];

    for (const { dto, originalRowNumber, originalRowData } of validCustomers) {
      if (seenCodes.has(dto.code)) {
        duplicateErrors.push({
          row: originalRowNumber,
          code: dto.code,
          error_type: 'DUPLICATE_IN_FILE',
          error_message: 'Bu kod dosya içinde tekrar ediyor',
          original_row_data: originalRowData || this.dtoToRecord(dto),
        });
      } else {
        seenCodes.add(dto.code);
      }
    }

    // Step 3: Commit valid rows to database
    const result = {
      total: customersWithRowNumbers.length,
      created: 0,
      skipped: validationErrors.length + duplicateErrors.length,
      errors: [
        ...validationErrors,
        ...duplicateErrors,
      ] as typeof validationErrors,
    };

    // Filter out duplicates from valid customers
    const uniqueValidCustomers = validCustomers.filter(
      ({ dto, originalRowNumber }) =>
        !duplicateErrors.some((e) => e.row === originalRowNumber),
    );

    for (const {
      dto: customerDto,
      originalRowNumber,
      originalRowData,
    } of uniqueValidCustomers) {
      try {
        const existing = await this.customerRepository.findByCode(
          tenantId,
          customerDto.code,
        );
        if (existing) {
          result.skipped++;
          result.errors.push({
            row: originalRowNumber,
            code: customerDto.code,
            error_type: 'ALREADY_EXISTS',
            error_message: 'Bu kod ile müşteri zaten mevcut',
            original_row_data: originalRowData || this.dtoToRecord(customerDto),
          });
          continue;
        }

        const customer = this.customerRepository.create({
          ...this.convertDateFields(customerDto),
          tenantId,
        });
        await this.customerRepository.save(customer);
        result.created++;
      } catch (error) {
        result.skipped++;
        const errorMessage =
          error instanceof Error ? error.message : 'Bilinmeyen hata';
        result.errors.push({
          row: originalRowNumber,
          code: customerDto.code || 'N/A',
          error_type: 'DATABASE_ERROR',
          error_message: errorMessage,
          original_row_data: originalRowData || this.dtoToRecord(customerDto),
        });
      }
    }

    return result;
  }

  private validateCustomerDto(
    dto: CreateCustomerDto,
    rowNumber: number,
  ): {
    row: number;
    code: string;
    error_type: string;
    error_message: string;
  } | null {
    // Required fields validation
    if (!dto.code || dto.code.trim() === '') {
      return {
        row: rowNumber,
        code: 'N/A',
        error_type: 'MISSING_FIELD',
        error_message: 'code alanı zorunludur',
      };
    }

    if (!dto.name || dto.name.trim() === '') {
      return {
        row: rowNumber,
        code: dto.code,
        error_type: 'MISSING_FIELD',
        error_message: 'name alanı zorunludur',
      };
    }

    if (!dto.channel) {
      return {
        row: rowNumber,
        code: dto.code,
        error_type: 'MISSING_FIELD',
        error_message: 'channel alanı zorunludur',
      };
    }

    // Date format and validity validation (YYYY-MM-DD)
    const dateFields = [
      { field: 'lastOrderDate', value: dto.lastOrderDate },
      { field: 'firstOrderDate', value: dto.firstOrderDate },
      { field: 'contractStartDate', value: dto.contractStartDate },
      { field: 'contractEndDate', value: dto.contractEndDate },
    ];

    for (const { field, value } of dateFields) {
      if (value) {
        // Check format first
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return {
            row: rowNumber,
            code: dto.code,
            error_type: 'INVALID_DATE',
            error_message: `${field} geçersiz tarih formatı. YYYY-MM-DD formatında olmalıdır`,
          };
        }

        // Validate date is actually valid (not just format)
        // This catches invalid dates like 2024-02-30 that pass regex but are invalid
        const dateValidation = this.validateDateString(value);
        if (!dateValidation.isValid) {
          return {
            row: rowNumber,
            code: dto.code,
            error_type: 'INVALID_DATE',
            error_message: `${field} geçersiz tarih: ${dateValidation.error}`,
          };
        }
      }
    }

    // Amount validation (if provided)
    if (dto.annualRevenue !== undefined && dto.annualRevenue < 0) {
      return {
        row: rowNumber,
        code: dto.code,
        error_type: 'INVALID_AMOUNT',
        error_message: 'annualRevenue negatif olamaz',
      };
    }

    if (dto.creditLimit !== undefined && dto.creditLimit < 0) {
      return {
        row: rowNumber,
        code: dto.code,
        error_type: 'INVALID_AMOUNT',
        error_message: 'creditLimit negatif olamaz',
      };
    }

    // Email validation (if provided)
    if (
      dto.contactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.contactEmail)
    ) {
      return {
        row: rowNumber,
        code: dto.code,
        error_type: 'INVALID_EMAIL',
        error_message: 'contactEmail geçersiz email formatı',
      };
    }

    return null;
  }

  /**
   * Validate date string is both correctly formatted and represents a valid date
   * Prevents silent data corruption from invalid dates like 2024-02-30
   *
   * @param dateString - Date string in YYYY-MM-DD format
   * @returns Object with isValid flag and optional error message
   */
  private validateDateString(dateString: string): {
    isValid: boolean;
    error?: string;
  } {
    // Parse the date components
    const parts = dateString.split('-');
    if (parts.length !== 3) {
      return { isValid: false, error: 'Tarih formatı hatalı' };
    }

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Check if parsing was successful
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return { isValid: false, error: 'Tarih bileşenleri sayısal değil' };
    }

    // Check month range
    if (month < 1 || month > 12) {
      return { isValid: false, error: `Geçersiz ay: ${month}` };
    }

    // Check day range (basic check)
    if (day < 1 || day > 31) {
      return { isValid: false, error: `Geçersiz gün: ${day}` };
    }

    // Create date object and verify it's valid
    const date = new Date(year, month - 1, day);

    // Check if date is valid (invalid dates become invalid Date objects)
    if (isNaN(date.getTime())) {
      return { isValid: false, error: 'Geçersiz tarih' };
    }

    // Critical: Verify the parsed date matches the input string
    // This catches cases where JavaScript auto-corrects invalid dates
    // e.g., 2024-02-30 becomes 2024-03-01, which we want to reject
    const parsedYear = date.getFullYear();
    const parsedMonth = String(date.getMonth() + 1).padStart(2, '0');
    const parsedDay = String(date.getDate()).padStart(2, '0');
    const parsedDateString = `${parsedYear}-${parsedMonth}-${parsedDay}`;

    if (parsedDateString !== dateString) {
      return {
        isValid: false,
        error: `Geçersiz tarih: ${dateString} (otomatik düzeltme: ${parsedDateString})`,
      };
    }

    return { isValid: true };
  }

  async getCplList(
    tenantId: string,
    channel?: string,
    categoryId?: string,
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      channel: string;
      customerCount: number;
      activeAgreementCount: number;
    }>
  > {
    return this.customerRepository.getCplList(tenantId, channel, categoryId);
  }

  private dtoToRecord(dto: CreateCustomerDto): Record<string, any> {
    return {
      code: dto.code,
      name: dto.name,
      channel: dto.channel,
      type: dto.type,
      status: dto.status,
      city: dto.city,
      district: dto.district,
      contactPerson: dto.contactPerson,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
      numberOfBranches: dto.numberOfBranches,
    };
  }
}
