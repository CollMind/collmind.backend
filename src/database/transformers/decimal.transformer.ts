import { ValueTransformer } from 'typeorm';

/**
 * TypeORM `decimal` sütunları driver seviyesinde string olarak döner
 * (pg parser BIGINT/NUMERIC güvenliği için). Bu transformer entity
 * sınırında sayıya çevirir; null/undefined korunur.
 */
export const DecimalTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined => {
    if (value === null || value === undefined) return value;
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  },
};
