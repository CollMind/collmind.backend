import { Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

/**
 * BaselineVolumeImportBatch — `main.baseline_volume_import_batches`
 * (`T-357` / `Z84`, migration `1822000000000`).
 *
 * ⚠️ BİLEREK MİNİMAL — yalnız `BaseEntity` alanları. `BL-2` (upload ucu +
 * parse, `docs/process/BL2_GIRIS_BRIEF.md`) henüz tasarlanmadı; dosya adı,
 * hash, satır sayıları gibi batch-özel alanlar (emsal: `SalesActualBatch`,
 * `OnInvoiceBatch`) BL-2'nin KENDİ migration'ında eklenir. Bu tablonun bugünkü
 * tek işi `baseline_volumes.import_batch_id`'nin FK hedefi olmak — `İlke 1`
 * (bugün ihtiyacı ölçülmeyen esneklik açılmaz).
 *
 * Her import-domain'in kendi batch tablosu vardır (bu repoda paylaşılan/genel
 * bir "import_batches" kavramı YOK — `sales_actual_batches`, `on_invoice_batches`
 * emsalleri) — bu tablo o desenin baseline-hacim karşılığı.
 */
@Entity({ name: 'baseline_volume_import_batches', schema: 'main' })
@Index('IDX_baseline_volume_import_batches_tenant', ['tenantId'])
export class BaselineVolumeImportBatch extends BaseEntity {
  // `foreignKeyConstraintName` + `onUpdate: 'NO ACTION'` — emsal 1815/1817:
  // entity susarsa `migration:generate` gerekçesiz DROP/ADD önerir.
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_baseline_volume_import_batches_tenant',
  })
  tenant!: Tenant;
}
