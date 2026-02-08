# Migration Fixes

## Düzeltilen Sorunlar

### 1. CreateKpis Migration - Enum Type Names
**Sorun:** Enum type'lar için `enumName` belirtilmemişti.

**Düzeltme:**
- `formula_type`: `enumName: 'kpis_formula_type_enum'`
- `calculation_level`: `enumName: 'kpis_calculation_level_enum'`
- `display_format`: `enumName: 'kpis_display_format_enum'`
- `aggregation_method_fu`: `enumName: 'kpis_aggregation_method_enum'`

### 2. CreateMasterDataEntities Migration - Enum Type Names
**Sorun:** Bazı enum type'lar için `enumName` belirtilmemişti.

**Düzeltme:**
- `tactic_type`: `enumName: 'tactics_tactic_type_enum'`
- `spend_type`: `enumName: 'tactics_spend_type_enum'`
- `mechanic_type`: `enumName: 'mechanics_mechanic_type_enum'`
- `status` (CPL): `enumName: 'cpls_status_enum'`

## Migration Çalıştırma

```bash
cd collmind.backend
npm run migration:run
```

## Notlar

- Enum type'lar DO $$ bloğu ile manuel oluşturuluyor
- Table.createTable() içinde `enumName` belirtmek TypeORM'ün enum type'ları doğru şekilde map etmesi için gerekli
- Migration sırası önemli: Master data entity'leri önce oluşturulmalı
