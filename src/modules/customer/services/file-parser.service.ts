import { Injectable, BadRequestException } from '@nestjs/common';
import {
  parseOptionalNumericText,
  describeNumericTextFailure,
} from '../../../common/numeric/numeric-text';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import {
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '../../../database/entities/customer.entity';

@Injectable()
export class FileParserService {
  async parseExcel(file: Express.Multer.File): Promise<
    Array<{
      dto: CreateCustomerDto;
      originalRowNumber: number;
      originalRowData?: Record<string, any>;
    }>
  > {
    try {
      // Security: Limit file size to prevent DoS attacks (10MB max)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.buffer.length > MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      // Security: Limit sheet processing to prevent ReDoS (CVE-2024-22363 mitigation)
      // Note: sheetRows includes header row, so 10001 = 1 header + 10000 data rows (consistent with CSV parser)
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: false, // Disable date parsing to reduce attack surface
        cellNF: false, // Disable number format parsing
        cellStyles: false, // Disable style parsing
        sheetRows: 10001, // Limit rows to prevent DoS (10000 data rows max, same as CSV parser)
      });

      // Security: Limit number of sheets processed
      if (workbook.SheetNames.length === 0) {
        throw new BadRequestException('Excel dosyası boş veya geçersiz.');
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Security: Additional validation - check if worksheet is valid
      if (!worksheet || !worksheet['!ref']) {
        throw new BadRequestException('Excel dosyası geçersiz veya boş.');
      }

      // Security: Use defval: false to prevent prototype pollution
      const data = XLSX.utils.sheet_to_json(worksheet, {
        raw: false,
        defval: false, // Prevent prototype pollution attacks
        blankrows: false, // Skip blank rows for performance
      });

      return this.mapToCustomerDtos(data);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(file: Express.Multer.File): Promise<
    Array<{
      dto: CreateCustomerDto;
      originalRowNumber: number;
      originalRowData?: Record<string, any>;
    }>
  > {
    try {
      // Security: Limit file size to prevent DoS attacks (10MB max) - same as parseExcel
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.buffer.length > MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      // Security: Limit row count to prevent DoS attacks (10000 data rows max, same as Excel parser)
      // Note: csv-parser handles header separately, so MAX_ROWS counts data rows only
      const MAX_ROWS = 10000;
      let rowCount = 0;

      return new Promise((resolve, reject) => {
        const results: Record<string, string>[] = [];
        const stream = Readable.from(file.buffer.toString('utf-8'));

        stream
          .pipe(csvParser())
          .on('data', (data: Record<string, string>) => {
            rowCount++;
            // Security: Stop processing if row limit exceeded
            if (rowCount > MAX_ROWS) {
              stream.destroy();
              reject(
                new BadRequestException(
                  `CSV dosyası çok fazla satır içeriyor. Maksimum ${MAX_ROWS} satır işlenebilir.`,
                ),
              );
              return;
            }
            results.push(data);
          })
          .on('end', () => {
            try {
              if (results.length === 0) {
                throw new BadRequestException('CSV dosyası boş veya geçersiz.');
              }
              const customerDtos = this.mapToCustomerDtos(results);
              resolve(customerDtos);
            } catch (error) {
              if (error instanceof BadRequestException) {
                reject(error);
                return;
              }
              const errorMessage =
                error instanceof Error ? error.message : 'Bilinmeyen hata';
              reject(
                new BadRequestException(
                  `CSV dosyası işlenemedi: ${errorMessage}`,
                ),
              );
            }
          })
          .on('error', (error: Error) => {
            const errorMessage =
              error instanceof Error ? error.message : 'Bilinmeyen hata';
            reject(
              new BadRequestException(`CSV dosyası okunamadı: ${errorMessage}`),
            );
          });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`CSV dosyası işlenemedi: ${errorMessage}`);
    }
  }

  private mapToCustomerDtos(data: any[]): Array<{
    dto: CreateCustomerDto;
    originalRowNumber: number;
    originalRowData?: Record<string, any>;
  }> {
    // Önce her satıra orijinal satır numarasını ekle (header + 1-based index)
    const dataWithRowNumbers = data.map((row, index) => ({
      ...row,
      _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
    }));

    // Sonra boş satırları filtrele ve DTO'ya çevir
    return dataWithRowNumbers
      .filter((row) => row.code || row.name) // Boş satırları filtrele
      .map((row) => {
        const dto: CreateCustomerDto = {
          code: this.getStringValue(
            row.code ||
              row.Code ||
              row.CODE ||
              `AUTO_${row._originalRowNumber}`,
          ),
          name: this.getStringValue(row.name || row.Name || row.NAME || ''),
          channel: this.getChannel(
            row.channel || row.Channel || row.CHANNEL || 'RETAIL',
          ),
          type: this.getType(row.type || row.Type || row.TYPE),
          status: this.getStatus(row.status || row.Status || row.STATUS),
          city: this.getOptionalString(row.city || row.City || row.CITY),
          district: this.getOptionalString(
            row.district || row.District || row.DISTRICT,
          ),
          region: this.getOptionalString(
            row.region || row.Region || row.REGION,
          ),
          country: this.getOptionalString(
            row.country || row.Country || row.COUNTRY,
          ),
          address: this.getOptionalString(
            row.address || row.Address || row.ADDRESS,
          ),
          postalCode: this.getOptionalString(
            row.postalCode ||
              row.postal_code ||
              row.PostalCode ||
              row.POSTAL_CODE,
          ),
          taxNumber: this.getOptionalString(
            row.taxNumber || row.tax_number || row.TaxNumber || row.TAX_NUMBER,
          ),
          taxOffice: this.getOptionalString(
            row.taxOffice || row.tax_office || row.TaxOffice || row.TAX_OFFICE,
          ),
          companyRegistrationNumber: this.getOptionalString(
            row.companyRegistrationNumber ||
              row.company_registration_number ||
              row.CompanyRegistrationNumber ||
              row.COMPANY_REGISTRATION_NUMBER,
          ),
          contactPerson: this.getOptionalString(
            row.contactPerson ||
              row.contact_person ||
              row.ContactPerson ||
              row.CONTACT_PERSON,
          ),
          contactEmail: this.getOptionalString(
            row.contactEmail ||
              row.contact_email ||
              row.ContactEmail ||
              row.CONTACT_EMAIL,
          ),
          contactPhone: this.getOptionalString(
            row.contactPhone ||
              row.contact_phone ||
              row.ContactPhone ||
              row.CONTACT_PHONE,
          ),
          contactMobile: this.getOptionalString(
            row.contactMobile ||
              row.contact_mobile ||
              row.ContactMobile ||
              row.CONTACT_MOBILE,
          ),
          paymentTerms: this.getOptionalString(
            row.paymentTerms ||
              row.payment_terms ||
              row.PaymentTerms ||
              row.PAYMENT_TERMS,
          ),
          creditLimit: this.getOptionalNumber(
            row.creditLimit ||
              row.credit_limit ||
              row.CreditLimit ||
              row.CREDIT_LIMIT,
          ),
          currency:
            this.getOptionalString(
              row.currency || row.Currency || row.CURRENCY,
            ) || 'TRY',
          salesRepresentative: this.getOptionalString(
            row.salesRepresentative ||
              row.sales_representative ||
              row.SalesRepresentative ||
              row.SALES_REPRESENTATIVE,
          ),
          accountManager: this.getOptionalString(
            row.accountManager ||
              row.account_manager ||
              row.AccountManager ||
              row.ACCOUNT_MANAGER,
          ),
          customerGroup: this.getOptionalString(
            row.customerGroup ||
              row.customer_group ||
              row.CustomerGroup ||
              row.CUSTOMER_GROUP,
          ),
          customerSegment: this.getOptionalString(
            row.customerSegment ||
              row.customer_segment ||
              row.CustomerSegment ||
              row.CUSTOMER_SEGMENT,
          ),
          customerTier: this.getOptionalString(
            row.customerTier ||
              row.customer_tier ||
              row.CustomerTier ||
              row.CUSTOMER_TIER,
          ),
          businessSize: this.getOptionalString(
            row.businessSize ||
              row.business_size ||
              row.BusinessSize ||
              row.BUSINESS_SIZE,
          ),
          annualRevenue: this.getOptionalNumber(
            row.annualRevenue ||
              row.annual_revenue ||
              row.AnnualRevenue ||
              row.ANNUAL_REVENUE,
          ),
          lastOrderDate: this.getOptionalDate(
            row.lastOrderDate ||
              row.last_order_date ||
              row.LastOrderDate ||
              row.LAST_ORDER_DATE,
          ),
          firstOrderDate: this.getOptionalDate(
            row.firstOrderDate ||
              row.first_order_date ||
              row.FirstOrderDate ||
              row.FIRST_ORDER_DATE,
          ),
          numberOfBranches: this.getOptionalNumber(
            row.numberOfBranches ||
              row.number_of_branches ||
              row.NumberOfBranches ||
              row.NUMBER_OF_BRANCHES,
          ),
          notes: this.getOptionalString(row.notes || row.Notes || row.NOTES),
          isVip: this.getOptionalBoolean(
            row.isVip || row.is_vip || row.IsVip || row.IS_VIP,
          ),
          contractStartDate: this.getOptionalDate(
            row.contractStartDate ||
              row.contract_start_date ||
              row.ContractStartDate ||
              row.CONTRACT_START_DATE,
          ),
          contractEndDate: this.getOptionalDate(
            row.contractEndDate ||
              row.contract_end_date ||
              row.ContractEndDate ||
              row.CONTRACT_END_DATE,
          ),
        };

        // Metadata objesi oluştur
        if (
          row.storeSize ||
          row.store_size ||
          row.StoreSize ||
          row.STORE_SIZE ||
          row.numberOfEmployees ||
          row.number_of_employees ||
          row.NumberOfEmployees ||
          row.NUMBER_OF_EMPLOYEES ||
          row.industry ||
          row.Industry ||
          row.INDUSTRY
        ) {
          dto.metadata = {
            storeSize: this.getOptionalNumber(
              row.storeSize ||
                row.store_size ||
                row.StoreSize ||
                row.STORE_SIZE,
            ),
            numberOfEmployees: this.getOptionalNumber(
              row.numberOfEmployees ||
                row.number_of_employees ||
                row.NumberOfEmployees ||
                row.NUMBER_OF_EMPLOYEES,
            ),
            industry: this.getOptionalString(
              row.industry || row.Industry || row.INDUSTRY,
            ),
          };
        }

        return {
          dto,
          originalRowNumber: row._originalRowNumber,
          originalRowData: row, // Store original row data for error reporting
        };
      });
  }

  private getStringValue(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private getOptionalString(value: any): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const str = String(value).trim();
    return str || undefined;
  }

  /**
   * T-105: `undefined` now means ABSENT and nothing else.
   *
   * It used to mean both "not given" and "unreadable", which merged a legitimate
   * absence with a silent failure (CLAUDE.md §2.5). It also rejected every Turkish
   * format outright — `1.234,56` went to `undefined` — so a credit limit written
   * the way a Turkish user writes it simply vanished from the import.
   *
   * ⚠️ BEHAVIOUR CHANGE, stated rather than buried: an unreadable value now throws,
   * and `mapToCustomerDtos` runs once for the whole file, so one bad cell rejects
   * the upload instead of silently dropping one field. That is the §2.5 direction
   * — a wrong credit limit is worse than a refused file — and it matches what the
   * on-invoice and off-invoice importers already do. It is NOT row-level, because
   * this parser has no row-level error channel to put it in; building one is a
   * separate task.
   */
  private getOptionalNumber(value: any): number | undefined {
    const result = parseOptionalNumericText(value);
    if (result === undefined) return undefined;
    if (!result.ok) {
      throw new BadRequestException(describeNumericTextFailure(result));
    }
    return Number(result.canonical);
  }

  private getOptionalBoolean(value: any): boolean | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const str = String(value).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'yes' || str === 'evet';
  }

  private getOptionalDate(value: any): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const str = String(value).trim();
    if (!str) return undefined;

    // Excel tarih formatını kontrol et (serial number)
    if (typeof value === 'number') {
      // Excel serial date to JavaScript date
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + value * 86400000);
      return jsDate.toISOString().split('T')[0];
    }

    // String tarih formatlarını dene
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    return undefined;
  }

  private getChannel(value: any): CustomerChannel {
    if (!value) return CustomerChannel.RETAIL;
    const channel = String(value).toUpperCase().trim();
    const validChannels = Object.values(CustomerChannel);
    return validChannels.includes(channel as CustomerChannel)
      ? (channel as CustomerChannel)
      : CustomerChannel.RETAIL;
  }

  private getType(value: any): CustomerType | undefined {
    if (!value) return undefined;
    const type = String(value).toUpperCase().trim();
    const validTypes = Object.values(CustomerType);
    return validTypes.includes(type as CustomerType)
      ? (type as CustomerType)
      : undefined;
  }

  private getStatus(value: any): CustomerStatus | undefined {
    if (!value) return undefined;
    const status = String(value).toUpperCase().trim();
    const validStatuses = Object.values(CustomerStatus);
    return validStatuses.includes(status as CustomerStatus)
      ? (status as CustomerStatus)
      : undefined;
  }
}
