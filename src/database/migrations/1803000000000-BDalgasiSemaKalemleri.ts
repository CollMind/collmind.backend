import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B dalgası — `L2` kurallarının şema tarafı: `S1`–`S15` (S3 hariç) + `R1` + `R2a` + `R3`.
 *
 * Kaynak (kanonik): `docs/brd-v2/EK_C_VERI_SOZLUGU.md` § "`B` dalgası — kanonik kalem
 * listesi`. Görev: `.claude/backlog/tasks/T-211.md`. Ölçüm gövdesi: `docs/analysis/0069`,
 * `docs/analysis/0070`.
 *
 * ⚠️ ÜÇ BAĞLAYICI KISIT (ürün sahibi, 2026-08-13):
 *   1. Tek geri dönüş noktası — TEK migration seti, TEK `down`.
 *   2. Çıkarmalar dalganın parçası — `R1`/`R2a`/`R3` ertelenmez, EN SONDA çalışır.
 *   3. Seed atomik — bu migration'ın KAPSAMINDA DEĞİL (ayrı, `npm run seed`), ama
 *      `fiscal_periods`/`budget_policies`/`approval_policies`/`roles`/`mechanics`
 *      seed'in YAZABİLECEĞİ şekilde açılır.
 *
 * DALGADA DEĞİL (gerekçeleri `EK_C` § "Dalgaya GİRMEYEN"):
 *   - `S3` (net = brüt − indirim CHECK'i) — `C3` veri ölçümü 3/3 satırda reddedildi,
 *     bir tanım sorunu (`v2-UC-ALAN`, [[T-209]]), veri düzeltmesi değil.
 *   - `K-2.7.4a` (net ≤ brüt akıl sağlığı kontrolü) — `C2`'ye bağlı ([[T-208]]).
 *   - `S13` (`updated_by` "yeni kolon" önermesi çürüdü — `BaseEntity`'de zaten var,
 *     [[T-207]]) — servis tarafı iş, migration'da DEĞİL.
 *   - `R2b` (ölü kod referansları: APPROVER 7 dosya, MANAGER 13, FINANCE 6) — ayrı PR.
 *
 * İÇ SIRA (bağlayıcı, task brief'i):
 *   1. donemler (fiscal_periods) tablosu
 *   2. yeni tablolar: S4 S5 S6 S7 S8
 *   3. yeni alanlar: S1 S2 S9 S12 S14
 *   4. enum genişletmeleri: S10 tipleri + S15 durumu
 *   5. backfill: TERS_KAYIT işaretlemesi · S11 dönem referansları
 *   6. CHECK'ler: alt-tür çift yönlü kısıtı (+ diğer bütünlük kısıtları)
 *   7. çıkarmalar: R1 R2a R3 — EN SONA
 *
 * S10 tablo-seçimi notu (data-engineer yorumu, Team Lead onayına açık): EK_C'nin
 * `defter_kayitlari` (C.7) alan listesi bugünkü İKİ fiziksel tabloyu (`budget_transactions`
 * "işlem tipi" 6/8 değer birebir eşleşiyor; `ledger_entries` yön+ters-kayıt+harcama-tipi
 * birebir eşleşiyor) TEK kavramda birleştiriyor. Ayrıştırma gerekçeli: `budget_transactions.
 * tx_type`'a TAHAKKUK/TÜKETİM (ACCRUE/CONSUME) eklendi, `ledger_entries.spend_type`'dan
 * TAHAKKUK (ACCRUAL, 0 satırda kullanılıyordu) çıkarıldı, `duzeltme_alt_turu` `ledger_
 * entries`'e eklendi (reversal alanları zaten orada yaşıyor). Bu üç karar ayrı ayrı
 * ölçüldü — bkz. entity yorumları. Rapor: final teslimde Team Lead'e ayrıca bildirildi.
 */
export class BDalgasiSemaKalemleri1803000000000 implements MigrationInterface {
  name = 'BDalgasiSemaKalemleri1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ════════════════════════════════════════════════════════════════════════════════
    // 1) DONEMLER (fiscal_periods) TABLOSU — S11
    // ════════════════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TYPE "main"."fiscal_period_status_enum" AS ENUM ('OPEN', 'CLOSED');
    `);
    await queryRunner.query(`
      CREATE TABLE "main"."fiscal_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "kod" character varying(7) NOT NULL,
        "status" "main"."fiscal_period_status_enum" NOT NULL DEFAULT 'OPEN',
        "closed_at" TIMESTAMP,
        "closed_by" uuid,
        "reopened_at" TIMESTAMP,
        "reopened_by" uuid,
        CONSTRAINT "PK_fiscal_periods" PRIMARY KEY ("id"),
        -- K-2.3.10: "her anahtar kayıtlı bir biçime uyar, biçim TEK YERDE tanımlıdır."
        -- Sekiz mevcut dönem kolonu buraya FK ile bağlanır (aşağı, faz 5) — biçim
        -- doğrulaması bir kez burada yaşar, sekiz kez tekrar edilmez.
        CONSTRAINT "CHK_fiscal_periods_kod_format" CHECK ("kod" ~ '^\\d{4}-(0[1-9]|1[0-2])$')
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fiscal_periods_tenant_kod" ON "main"."fiscal_periods" ("tenant_id", "kod");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."fiscal_periods"
      ADD CONSTRAINT "FK_fiscal_periods_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);

    // ════════════════════════════════════════════════════════════════════════════════
    // 2) YENİ TABLOLAR — S4 · S5 · S6 · S7 · S8
    // ════════════════════════════════════════════════════════════════════════════════
    await this.createS4BudgetPolicies(queryRunner);
    await this.createS5ApprovalPolicies(queryRunner);
    await this.createS6RoleFamily(queryRunner);
    await this.createS7Claims(queryRunner);
    await this.createS8ClaimMatchesAndTacticRealizations(queryRunner);

    // ════════════════════════════════════════════════════════════════════════════════
    // 3) YENİ ALANLAR — S1 · S2 · S9 · S12 · S14
    // ════════════════════════════════════════════════════════════════════════════════
    await this.addS1MechanicFields(queryRunner);
    await this.addS2ImportProvenanceFields(queryRunner);
    await this.addS9OnInvoiceAgreementRef(queryRunner);
    await this.addS12SkuUnitFields(queryRunner);
    await this.addS14SalesActualSkuVolumeFields(queryRunner);

    // ════════════════════════════════════════════════════════════════════════════════
    // 4) ENUM GENİŞLETMELERİ — S10 tipleri + S15 durumu
    // ════════════════════════════════════════════════════════════════════════════════
    await this.applyS10LedgerAndBudgetTxTypes(queryRunner);
    await this.applyS15PlanExpiredStatus(queryRunner);

    // ════════════════════════════════════════════════════════════════════════════════
    // 5) BACKFILL — TERS_KAYIT işaretlemesi · S11 dönem referansları
    // ════════════════════════════════════════════════════════════════════════════════
    await this.backfillLedgerReversalSubtype(queryRunner);
    await this.backfillFiscalPeriodsAndLinkFks(queryRunner);

    // ════════════════════════════════════════════════════════════════════════════════
    // 6) CHECK'LER — alt-tür çift yönlü kısıtı + diğer bütünlük kısıtları
    // ════════════════════════════════════════════════════════════════════════════════
    await this.addIntegrityChecks(queryRunner);

    // ════════════════════════════════════════════════════════════════════════════════
    // 7) ÇIKARMALAR — R1 · R2a · R3 — EN SONA
    // ════════════════════════════════════════════════════════════════════════════════
    await this.applyR1DropLedgerDeletedAt(queryRunner);
    await this.applyR2aUserRoleEnum(queryRunner);
    await this.applyR3DropSkuUnitOfMeasure(queryRunner);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S4 — butce_politikalari (K-2.2.8a–8f)
  // ────────────────────────────────────────────────────────────────────────────────
  private async createS4BudgetPolicies(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "main"."budget_policy_finance_review_mode_enum" AS ENUM ('NOTIFY', 'APPROVE');
    `);
    await queryRunner.query(`
      CREATE TABLE "main"."budget_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "channel_id" uuid,
        "category_id" uuid,
        "warning_threshold_pct" numeric(5,2) NOT NULL DEFAULT 80,
        "finance_review_threshold_pct" numeric(5,2) NOT NULL DEFAULT 90,
        "block_threshold_pct" numeric(5,2) NOT NULL DEFAULT 100,
        "finance_review_mode" "main"."budget_policy_finance_review_mode_enum" NOT NULL DEFAULT 'NOTIFY',
        CONSTRAINT "PK_budget_policies" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_budget_policies_threshold_ladder" CHECK (
          "warning_threshold_pct" > 0
          AND "warning_threshold_pct" <= "finance_review_threshold_pct"
          AND "finance_review_threshold_pct" <= "block_threshold_pct"
        )
      );
    `);
    // K-2.2.8b: çakışma veritabanı seviyesinde imkânsız — NULLS NOT DISTINCT (PG15+)
    // joker (channel/category ikisi de NULL) satırının da tekilliğini korur.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_budget_policies_tenant_channel_category"
      ON "main"."budget_policies" ("tenant_id", "channel_id", "category_id") NULLS NOT DISTINCT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."budget_policies"
      ADD CONSTRAINT "FK_budget_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_budget_policies_channel" FOREIGN KEY ("channel_id") REFERENCES "main"."channels"("id"),
      ADD CONSTRAINT "FK_budget_policies_category" FOREIGN KEY ("category_id") REFERENCES "main"."categories"("id");
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S5 — onay_politikalari (K-2.5.13–13f)
  // ────────────────────────────────────────────────────────────────────────────────
  private async createS5ApprovalPolicies(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "main"."approval_policy_template_enum" AS ENUM ('STANDARD', 'TWO_TIER', 'THRESHOLD');
    `);
    await queryRunner.query(`
      CREATE TABLE "main"."approval_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "template" "main"."approval_policy_template_enum" NOT NULL,
        "amount_threshold" numeric(18,2),
        "delegate_allowed" boolean NOT NULL DEFAULT false,
        "tier_roles" jsonb,
        CONSTRAINT "PK_approval_policies" PRIMARY KEY ("id"),
        -- K-2.5.13a: yalnız THRESHOLD şablonu bir tutar eşiği taşır/gerektirir.
        CONSTRAINT "CHK_approval_policies_threshold_template" CHECK (
          ("template" = 'THRESHOLD' AND "amount_threshold" IS NOT NULL)
          OR ("template" <> 'THRESHOLD' AND "amount_threshold" IS NULL)
        ),
        CONSTRAINT "CHK_approval_policies_amount_threshold_positive" CHECK (
          "amount_threshold" IS NULL OR "amount_threshold" > 0
        )
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."approval_policies"
      ADD CONSTRAINT "FK_approval_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);
    // approval_requests.approval_policy_id artık gerçek bir tabloya işaret edebilir.
    // Ölçüldü (2026-08-13, bu migration öncesi): main.approval_requests 0 satır —
    // FK'yi dangling bırakan veri yok.
    await queryRunner.query(`
      ALTER TABLE "main"."approval_requests"
      ADD CONSTRAINT "FK_approval_requests_approval_policy" FOREIGN KEY ("approval_policy_id") REFERENCES "main"."approval_policies"("id") ON DELETE RESTRICT;
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S6 — roller · yetenekler · rol_yetenekleri · kullanici_rolleri (K-2.6.4, K-2.6.5a–5d)
  // ────────────────────────────────────────────────────────────────────────────────
  private async createS6RoleFamily(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "main"."roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "code" character varying(50) NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_roles_tenant_code" ON "main"."roles" ("tenant_id", "code");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."roles"
      ADD CONSTRAINT "FK_roles_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      CREATE TABLE "main"."capabilities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "code" character varying(100) NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        CONSTRAINT "PK_capabilities" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_capabilities_tenant_code" ON "main"."capabilities" ("tenant_id", "code");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."capabilities"
      ADD CONSTRAINT "FK_capabilities_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      CREATE TABLE "main"."role_capabilities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "role_id" uuid NOT NULL,
        "capability_id" uuid NOT NULL,
        CONSTRAINT "PK_role_capabilities" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_role_capabilities_role_capability" ON "main"."role_capabilities" ("role_id", "capability_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."role_capabilities"
      ADD CONSTRAINT "FK_role_capabilities_role" FOREIGN KEY ("role_id") REFERENCES "main"."roles"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "FK_role_capabilities_capability" FOREIGN KEY ("capability_id") REFERENCES "main"."capabilities"("id") ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      CREATE TABLE "main"."user_role_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_role_assignments" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_role_assignments_user_role" ON "main"."user_role_assignments" ("user_id", "role_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."user_role_assignments"
      ADD CONSTRAINT "FK_user_role_assignments_user" FOREIGN KEY ("user_id") REFERENCES "main"."users"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "FK_user_role_assignments_role" FOREIGN KEY ("role_id") REFERENCES "main"."roles"("id") ON DELETE CASCADE;
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S7 — talepler (K-2.13.3–2.13.9, K-2.13.5–5g)
  // ────────────────────────────────────────────────────────────────────────────────
  private async createS7Claims(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "main"."claim_source_enum" AS ENUM ('INTERNAL', 'EXTERNAL');
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."claim_status_enum" AS ENUM (
        'RECEIVED', 'MATCHED', 'ACCEPTED', 'REJECTED', 'DISPUTED',
        'GENERATED', 'SUBMITTED', 'FULFILLED'
      );
    `);
    await queryRunner.query(`
      CREATE TABLE "main"."claims" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "source" "main"."claim_source_enum" NOT NULL,
        "agreement_id" uuid NOT NULL,
        "period_month" character varying(7) NOT NULL,
        "cpl_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "status" "main"."claim_status_enum" NOT NULL,
        "supporting_document_ref" text,
        "audit_trail_ref" text,
        "produced_or_received_at" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_claims" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_claims_amount_positive" CHECK ("amount" > 0),
        -- K-2.13.5b: doğrulama kaynağa koşullu.
        CONSTRAINT "CHK_claims_source_evidence" CHECK (
          ("source" = 'EXTERNAL' AND "supporting_document_ref" IS NOT NULL)
          OR ("source" = 'INTERNAL' AND "audit_trail_ref" IS NOT NULL)
        )
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claims_tenant_source_status" ON "main"."claims" ("tenant_id", "source", "status");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claims_tenant_agreement" ON "main"."claims" ("tenant_id", "agreement_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claims_tenant_grain" ON "main"."claims" ("tenant_id", "period_month", "cpl_id", "category_id", "channel_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."claims"
      ADD CONSTRAINT "FK_claims_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_claims_agreement" FOREIGN KEY ("agreement_id") REFERENCES "main"."agreements"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_claims_cpl" FOREIGN KEY ("cpl_id") REFERENCES "main"."cpls"("id"),
      ADD CONSTRAINT "FK_claims_category" FOREIGN KEY ("category_id") REFERENCES "main"."categories"("id"),
      ADD CONSTRAINT "FK_claims_channel" FOREIGN KEY ("channel_id") REFERENCES "main"."channels"("id");
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S8 — eslestirmeler (K-2.13.5f) + taktik_gerceklesmeleri (K-2.13.14e–14k)
  // ────────────────────────────────────────────────────────────────────────────────
  private async createS8ClaimMatchesAndTacticRealizations(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "main"."claim_match_variance_class_enum" AS ENUM ('TIMING', 'AMOUNT', 'SCOPE');
    `);
    // ⚠️ Sıra istisnası: `evidence_class_enum` "sahibi" S1'dir (mekanikler), ama
    // `taktik_gerceklesmeleri` (S8, K-2.13.27) onu HEMEN kullanır ve S8, iç sırada
    // S1'den ÖNCE gelir ("2 yeni tablolar" → "3 yeni alanlar"). Tip burada, erken
    // yaratılır; `addS1MechanicFields` onu YENİDEN YARATMAZ, yalnız kullanır.
    await queryRunner.query(`
      CREATE TYPE "main"."evidence_class_enum" AS ENUM ('OBSERVED', 'DERIVABLE', 'CONTRACTUAL');
    `);
    await queryRunner.query(`
      CREATE TABLE "main"."claim_matches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "internal_claim_id" uuid NOT NULL,
        "external_claim_id" uuid NOT NULL,
        "variance_amount" numeric(18,2) NOT NULL,
        "variance_class" "main"."claim_match_variance_class_enum" NOT NULL,
        "decision" text,
        "decided_by" uuid,
        "decided_at" TIMESTAMP,
        CONSTRAINT "PK_claim_matches" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_claim_matches_distinct_claims" CHECK ("internal_claim_id" <> "external_claim_id")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claim_matches_tenant_internal" ON "main"."claim_matches" ("tenant_id", "internal_claim_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_claim_matches_tenant_external" ON "main"."claim_matches" ("tenant_id", "external_claim_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."claim_matches"
      ADD CONSTRAINT "FK_claim_matches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_claim_matches_internal_claim" FOREIGN KEY ("internal_claim_id") REFERENCES "main"."claims"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_claim_matches_external_claim" FOREIGN KEY ("external_claim_id") REFERENCES "main"."claims"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_claim_matches_decided_by" FOREIGN KEY ("decided_by") REFERENCES "main"."users"("id");
    `);

    await queryRunner.query(`
      CREATE TABLE "main"."tactic_realizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "claim_id" uuid NOT NULL,
        "mechanic_id" uuid NOT NULL,
        "calculated_amount" numeric(18,2) NOT NULL,
        "evidence_class" "main"."evidence_class_enum" NOT NULL,
        CONSTRAINT "PK_tactic_realizations" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tactic_realizations_tenant_claim" ON "main"."tactic_realizations" ("tenant_id", "claim_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tactic_realizations_tenant_mechanic" ON "main"."tactic_realizations" ("tenant_id", "mechanic_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."tactic_realizations"
      ADD CONSTRAINT "FK_tactic_realizations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_tactic_realizations_claim" FOREIGN KEY ("claim_id") REFERENCES "main"."claims"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_tactic_realizations_mechanic" FOREIGN KEY ("mechanic_id") REFERENCES "main"."mechanics"("id") ON DELETE RESTRICT;
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S1 — mekanikler: kadans · tahakkuk takvimi · taban · azami süre · kanıt sınıfı
  // (K-2.1.13, K-2.13.14f, K-2.13.14h3)
  // ────────────────────────────────────────────────────────────────────────────────
  private async addS1MechanicFields(queryRunner: QueryRunner): Promise<void> {
    // `evidence_class_enum` zaten var — bkz. `createS8ClaimMatchesAndTacticRealizations`
    // yorumu (sıra istisnası).
    await queryRunner.query(`
      CREATE TYPE "main"."settlement_cadence_enum" AS ENUM ('SINGLE', 'PERIODIC');
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."accrual_schedule_enum" AS ENUM ('NONE', 'MONTHLY');
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."mechanic_base_enum" AS ENUM ('GROSS', 'NET');
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."mechanics"
      ADD COLUMN "evidence_class" "main"."evidence_class_enum",
      ADD COLUMN "settlement_cadence" "main"."settlement_cadence_enum",
      ADD COLUMN "accrual_schedule" "main"."accrual_schedule_enum" NOT NULL DEFAULT 'NONE',
      ADD COLUMN "base" "main"."mechanic_base_enum" NOT NULL DEFAULT 'NET',
      ADD COLUMN "max_duration_days" integer;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."mechanics"
      ADD CONSTRAINT "CHK_mechanics_max_duration_days_positive" CHECK ("max_duration_days" IS NULL OR "max_duration_days" > 0);
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S2 — içe aktarma köken bloğu: dosya özeti (K-2.13.12b). "kim"/"ne zaman" zaten
  // BaseEntity üzerinden var; "çevrim izi" S14 ile sales_actuals'a eklenir.
  // ────────────────────────────────────────────────────────────────────────────────
  private async addS2ImportProvenanceFields(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_batches"
      ADD COLUMN "file_content_hash" character(64);
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S9 — fatura-içi kayıtlara anlaşma referansı (K-2.13.14l)
  // ────────────────────────────────────────────────────────────────────────────────
  private async addS9OnInvoiceAgreementRef(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_entries"
      ADD COLUMN "agreement_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_entries"
      ADD CONSTRAINT "FK_on_invoice_entries_agreement" FOREIGN KEY ("agreement_id") REFERENCES "main"."agreements"("id") ON DELETE RESTRICT;
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S12 — SKU: satis_birimi + cevrim_carpani (K-2.1.12c). "Girilen değer FU'ya" kısmı
  // (K-2.1.11a) ZATEN uygulanıyor — plan_mechanic_values plan_fu_id anahtarlı, ölçüldü
  // (migration 1796/1797). Bu faz yalnız SKU kolonlarını ekler.
  // ────────────────────────────────────────────────────────────────────────────────
  private async addS12SkuUnitFields(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."skus"
      ADD COLUMN "sales_unit" character varying(20),
      ADD COLUMN "conversion_factor" numeric(9,4) NOT NULL DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."skus"
      ADD CONSTRAINT "CHK_skus_conversion_factor_positive" CHECK ("conversion_factor" > 0);
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S14 — sales_actuals: SKU kırılımı + hacim (K-2.1.8a) + S2'nin çevrim izi (K-2.1.12d)
  // ────────────────────────────────────────────────────────────────────────────────
  private async addS14SalesActualSkuVolumeFields(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."sales_actuals"
      ADD COLUMN "fu_id" uuid,
      ADD COLUMN "sku_id" uuid,
      ADD COLUMN "volume" numeric(18,3),
      ADD COLUMN "raw_volume_input" numeric(18,3),
      ADD COLUMN "volume_conversion_factor" numeric(9,4);
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."sales_actuals"
      ADD CONSTRAINT "CHK_sales_actuals_volume_non_negative" CHECK ("volume" IS NULL OR "volume" >= 0);
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S10 — Defter: TAHAKKUK+TÜKETİM tipleri, TAHAKKUK harcama tipinden çıkar,
  // duzeltme_alt_turu (K-2.3.13–13d, K-2.3.14)
  // ────────────────────────────────────────────────────────────────────────────────
  private async applyS10LedgerAndBudgetTxTypes(
    queryRunner: QueryRunner,
  ): Promise<void> {
    // (a) budget_transactions.tx_type += ACCRUE, CONSUME (K-2.3.13, TAHAKKUK/TÜKETİM).
    // ⚠️ `ALTER TYPE ... ADD VALUE` KULLANILMADI — Postgres eklenen bir enum değerini
    // asla düşüremez (bkz. migration 1775'in aynı notu), yani `down()` bu iki etiketi
    // KALICI olarak DB'de bırakırdı ve `kabul-1`'in "sonrası şema diff = BOŞ" şartını
    // ihlal ederdi. Bunun yerine `ledger_entries.spend_type` ile aynı desen: yeni tip +
    // dönüşüm — TAM geri alınabilir (T-211 Postgres notu: "ikisi de down'da geri
    // alınabilir olmalı", yalnız R2a için değil).
    // ⚠️ Ölçüldü: `main.v_budget_summary` `bt.tx_type` üzerinden filtreliyor — bir
    // VIEW herhangi bir sütununa bakıyorsa Postgres o sütunun TİPİNİ değiştirmeye
    // izin vermez (REPLACE de yetmez, DROP gerekir). View bu adımda `deleted_at`
    // hâlâ var olan ORİJİNAL (filtreli, `true`) hâliyle yeniden yaratılır — R1
    // (faz 7) ledger_entries.deleted_at'i kaldırdığında kendi drop-recreate'ini
    // ayrıca yapar.
    await queryRunner.query(`DROP VIEW "main"."v_budget_summary";`);
    await queryRunner.query(`
      ALTER TYPE "main"."budget_transactions_tx_type_enum" RENAME TO "budget_transactions_tx_type_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."budget_transactions_tx_type_enum" AS ENUM (
        'ALLOCATE', 'COMMIT', 'RESERVE', 'RELEASE', 'TRANSFER', 'ADJUST', 'ACCRUE', 'CONSUME'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."budget_transactions"
      ALTER COLUMN "tx_type" TYPE "main"."budget_transactions_tx_type_enum"
      USING "tx_type"::text::"main"."budget_transactions_tx_type_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "main"."budget_transactions_tx_type_enum_old";`,
    );
    await queryRunner.query(this.vBudgetSummaryViewSql(true));

    // (b) ledger_entries.spend_type: ACCRUAL ÇIKAR (K-2.3.14, harcama tipi 4→3 değer).
    // Postgres enum değeri DÜŞÜREMEZ — yeni tip + dönüşüm. 3-yollu assert: ACCRUAL
    // kullanan satır sayısı 0 olmalı (ölçüldü: main.ledger_entries BOŞ, 0 satır).
    const [{ cnt: accrualUsers }]: [{ cnt: number }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt FROM "main"."ledger_entries" WHERE "spend_type" = 'ACCRUAL';
    `);
    if (accrualUsers !== 0) {
      throw new Error(
        `B dalgası / S10 ASSERT başarısız: main.ledger_entries'te spend_type='ACCRUAL' ` +
          `taşıyan ${accrualUsers} satır var (0 bekleniyordu). Bu satırların yeni ` +
          `harcama tipi (TAHAKKUK artık bir işlem tipi, harcama tipi değil) elle karara ` +
          `bağlanmadan enum daraltılamaz. Migration İPTAL edildi — Team Lead'e bildir.`,
      );
    }
    await queryRunner.query(`
      ALTER TYPE "main"."ledger_entries_spend_type_enum" RENAME TO "ledger_entries_spend_type_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."ledger_entries_spend_type_enum" AS ENUM ('ON_INVOICE', 'OFF_INVOICE', 'ADJUSTMENT');
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
      ALTER COLUMN "spend_type" TYPE "main"."ledger_entries_spend_type_enum"
      USING "spend_type"::text::"main"."ledger_entries_spend_type_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "main"."ledger_entries_spend_type_enum_old";`,
    );

    // (c) ledger_entries.adjustment_subtype (K-2.3.13a): 4 değer, DÜZELTME'nin alt türü.
    await queryRunner.query(`
      CREATE TYPE "main"."ledger_adjustment_subtype_enum" AS ENUM (
        'REVERSAL', 'VARIANCE', 'CAP_OVERAGE', 'TOLERANCE_VARIANCE'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
      ADD COLUMN "adjustment_subtype" "main"."ledger_adjustment_subtype_enum";
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // S15 — planlar: SÜRESİ_DOLDU durumu (K-2.5.10b, K-2.5.10e). Enum bugün, davranış
  // (otomatik geçiş) Faz 2.
  // ────────────────────────────────────────────────────────────────────────────────
  private async applyS15PlanExpiredStatus(
    queryRunner: QueryRunner,
  ): Promise<void> {
    // Aynı gerekçe: `ADD VALUE` yerine tip değişimi — tam geri alınabilir.
    await queryRunner.query(`
      ALTER TYPE "main"."plans_plan_status_enum" RENAME TO "plans_plan_status_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."plans_plan_status_enum" AS ENUM (
        'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PENDING_FINANCE_REVIEW', 'EXPIRED'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans" ALTER COLUMN "status" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans"
      ALTER COLUMN "status" TYPE "main"."plans_plan_status_enum"
      USING "status"::text::"main"."plans_plan_status_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
    `);
    await queryRunner.query(`DROP TYPE "main"."plans_plan_status_enum_old";`);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Backfill (a) — TERS_KAYIT işaretlemesi (K-2.3.13d)
  // ────────────────────────────────────────────────────────────────────────────────
  private async backfillLedgerReversalSubtype(
    queryRunner: QueryRunner,
  ): Promise<void> {
    // Bugün mevcut ters kayıtlar (reverses_entry_id dolu) DÜZELTME/REVERSAL ile
    // işaretlenir — yoksa kural doğduğu gün mevcut veriyi ihlal eder (K-2.3.13d).
    // ⚠️ Ölçüldü (2026-08-13, bu migration öncesi): main.ledger_entries 0 satır — bu
    // UPDATE bu ortamda NO-OP. Kalıcı doğruluk için servis tarafının (ledger.service.ts
    // reversal yolu) da spend_type='ADJUSTMENT' + adjustment_subtype='REVERSAL'
    // yazması gerekir — bugün `spendType: original.spendType` kopyalıyor. Bu bir şema
    // kalemi değil, ayrı bir servis task'ı (rapor: final teslimde Team Lead'e bildirildi).
    await queryRunner.query(`
      UPDATE "main"."ledger_entries"
         SET "spend_type" = 'ADJUSTMENT',
             "adjustment_subtype" = 'REVERSAL'
       WHERE "reverses_entry_id" IS NOT NULL
         AND "adjustment_subtype" IS NULL;
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Backfill (b) — S11 dönem referansları: fiscal_periods'u sekiz mevcut dönem
  // kolonundaki (+ yeni claims.period_month) TÜM ayrık değerlerle doldur.
  //
  // ⛔ B1 (code-reviewer, 2026-08-13 — `EK_C § S11'in FK'leri GERİ ÇEKİLDİ`): FK EKLEME
  // adımı bu metottan ÇIKARILDI. FK'ler canlıydı (`23503` pozitif kontrollü ölçüldü) ama
  // dönem YARATAN bir üretim yolu yok — controller 0, servis 0, `TenantService.create`
  // dönem kurmuyor, pencere yalnız bir seed dosyasında sabit (2025-01..2027-12). API'den
  // doğan her yeni tenant sıfır dönemle doğuyor, ilk anlaşma/plan/sales-actual yazması
  // ham `23503` ile `500` dönerdi. `F12` kararının kendi sınırına dönüş: tablo + backfill
  // BU dalgada, FK **ön koşulu bir ürün yeteneği** (dönem yaratma) olan SONRAKİ dalgada.
  // `fiscal_periods` tablosu, `CHK_fiscal_periods_kod_format` ve bu backfill KALIYOR.
  // ────────────────────────────────────────────────────────────────────────────────
  private async backfillFiscalPeriodsAndLinkFks(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const sources: Array<{ table: string; column: string; nullable: boolean }> =
      [
        {
          table: 'agreement_transactions',
          column: 'fiscal_period',
          nullable: true,
        },
        {
          table: 'on_invoice_batches',
          column: 'fiscal_period',
          nullable: false,
        },
        {
          table: 'on_invoice_entries',
          column: 'fiscal_period',
          nullable: false,
        },
        {
          table: 'sales_actual_batches',
          column: 'fiscal_period',
          nullable: false,
        },
        { table: 'sales_actuals', column: 'fiscal_period', nullable: false },
        { table: 'agreements', column: 'period_month', nullable: false },
        { table: 'ledger_entries', column: 'period_month', nullable: false },
        { table: 'plans', column: 'period_month', nullable: false },
      ];

    // Ö4: "mevcut satırların temiz olması kural değil, TESADÜF" — CHECK format'ı
    // fiscal_periods.kod'da yaşıyor (tek yer, K-2.3.10); bozuk bir değer INSERT'te
    // reddedilir ve migration İPTAL olur (sessiz atlama YOK).
    // `nullable` alanı yalnız belgeleme amaçlı kaldı (B1 öncesi FK-ekleme adımında
    // kullanılıyordu; o adım aşağıda tamamen çıkarıldı, kullanılmadığı için burada
    // destructure edilmiyor).
    for (const { table, column } of sources) {
      await queryRunner.query(`
        INSERT INTO "main"."fiscal_periods" ("tenant_id", "kod")
        SELECT DISTINCT "tenant_id", "${column}"
          FROM "main"."${table}"
         WHERE "${column}" IS NOT NULL
        ON CONFLICT DO NOTHING;
      `);
    }
    // ⛔ B1 (code-reviewer, 2026-08-13): burada DOKUZ `ADD CONSTRAINT ... FOREIGN KEY`
    // çağrısı (8 kaynak kolon + `claims.period_month`) vardı — hepsi ÇIKARILDI.
    // `fiscal_periods` artık yalnız bir KATALOG: dolduruluyor (yukarı), ama hiçbir tablo
    // ona referans zorunluluğuyla bağlanmıyor. `claims` tablosu da aynı nedenle FK'siz.
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // CHECK'ler — alt-tür çift yönlü kısıtı (K-2.3.13b) + tamamlayıcı bütünlük kısıtları
  // ────────────────────────────────────────────────────────────────────────────────
  private async addIntegrityChecks(queryRunner: QueryRunner): Promise<void> {
    // K-2.3.13b: DÜZELTME (spend_type=ADJUSTMENT) ⇔ alt tür dolu — ÇİFT YÖNLÜ.
    // Alt türsüz bir ADJUSTMENT de, alt türlü bir ON_INVOICE/OFF_INVOICE de reddedilir.
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
      ADD CONSTRAINT "CHK_ledger_entries_adjustment_subtype_bidirectional" CHECK (
        ("spend_type" = 'ADJUSTMENT') = ("adjustment_subtype" IS NOT NULL)
      );
    `);

    // EK_C "Özet — değişiklik hacmi": "defter tutarı ≥ 0" — bu dalganın kısıt
    // eklemeleri listesinde AÇIKÇA sayılı (`defter_kayitlari` § "⚠️ CHECK (tutar >= 0)
    // eksik"). Düzeltme kaydı YÖNLE yapılır (K-2.3.7) — DÜZELTME de dahil her satırın
    // tutarı negatif olamaz, yön (entry_direction) DEBIT/CREDIT ile ifade edilir.
    const [{ cnt: negativeAmounts }]: [{ cnt: number }] =
      await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt FROM "main"."ledger_entries" WHERE "amount" < 0;
    `);
    if (negativeAmounts !== 0) {
      throw new Error(
        `B dalgası ASSERT başarısız: main.ledger_entries'te negatif tutarlı ${negativeAmounts} ` +
          `satır var (0 bekleniyordu). Bu kısıt (K-2.3.7, EK_C özeti) eklenemiyor — ` +
          `Migration İPTAL edildi, Team Lead'e bildir.`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
      ADD CONSTRAINT "CHK_ledger_entries_amount_non_negative" CHECK ("amount" >= 0);
    `);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // R1 — ledger_entries.deleted_at KALDIRILIR (K-2.3.4)
  // ────────────────────────────────────────────────────────────────────────────────
  private async applyR1DropLedgerDeletedAt(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const [{ cnt: softDeleted }]: [{ cnt: number }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt FROM "main"."ledger_entries" WHERE "deleted_at" IS NOT NULL;
    `);
    if (softDeleted !== 0) {
      throw new Error(
        `B dalgası / R1 ASSERT başarısız: main.ledger_entries'te deleted_at dolu ${softDeleted} ` +
          `satır var (0 bekleniyordu — K-2.3.4 "hep boş olmalı"). Bu satırlar veri kaybı ` +
          `olmadan ele alınmalı önce. Migration İPTAL edildi — Team Lead'e bildir, elle silme YAPMA.`,
      );
    }
    // ⚠️ Ölçüldü (run denemesi, 2026-08-13): `main.v_budget_summary` (migration
    // 1789000000000-FixBudgetSummaryCommitDoubleCounting) `ledger_entries.deleted_at`'e
    // BAĞIMLI (iki alt sorguda `le.deleted_at IS NULL`). View önce düşürülür, kolon
    // sonra, view `le.deleted_at IS NULL` predikatı ÇIKARILMIŞ hâliyle yeniden yaratılır
    // (predikat her zaman doğruydu — ledger_entries hiçbir zaman soft-delete edilmedi,
    // R1'in kendisi bunu artık yapısal olarak imkânsız kılıyor). `bt.deleted_at IS NULL`
    // (budget_transactions) DOKUNULMAZ — o tablo bu migration'ın kapsamı dışında.
    await queryRunner.query(this.vBudgetSummaryViewSql(false));
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries" DROP COLUMN "deleted_at";
    `);
  }

  /**
   * `v_budget_summary` view SQL'i — hem `up()` (R1, `false`: filtre yok) hem `down()`
   * (`true`: filtre var, `1789000000000`'un orijinal metniyle KARAKTER KARAKTERİNE aynı)
   * tarafından kullanılır. `CREATE OR REPLACE VIEW` — `DROP VIEW` gerekmez.
   */
  private vBudgetSummaryViewSql(includeLedgerDeletedAtFilter: boolean): string {
    const ledgerFilter = includeLedgerDeletedAtFilter
      ? `\n              AND le.deleted_at IS NULL`
      : '';
    return `
      CREATE OR REPLACE VIEW main.v_budget_summary AS
      SELECT
        be.id AS envelope_id,
        be.tenant_id,
        be.code,
        be.name,
        be.fiscal_year,
        be.period,
        be.allocated_amount,
        be.currency,
        be.status,
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) AS reserved_amount,
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id${ledgerFilter}
          ),
          0
        ) AS consumed_amount,
        be.allocated_amount -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id${ledgerFilter}
          ),
          0
        ) AS available_amount,
        CASE
          WHEN be.allocated_amount > 0 THEN
            ROUND(
              (
                COALESCE(
                  (
                    SELECT
                      SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
                      SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
                FROM main.budget_transactions bt
                WHERE bt.envelope_id = be.id
                  AND bt.tx_status = 'POSTED'
                  AND bt.deleted_at IS NULL
              ),
              0
            ) +
            COALESCE(
              (
                SELECT
                  SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
                FROM main.ledger_entries le
                WHERE le.budget_envelope_id = be.id${ledgerFilter}
              ),
              0
            )
          ) / be.allocated_amount * 100,
          2
        )
        ELSE 0
      END AS utilization_pct,
        be.created_at,
        be.updated_at
      FROM main.budget_envelopes be
      WHERE be.deleted_at IS NULL;
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // R2a — users.role: bir yeniden adlandırma, üç silme — DEĞERLER ASCII KALIR
  // (K-2.6.4, K-2.6.4d). ⛔ P0 düzeltmesi (2026-08-13): ilk tur enum DEĞERLERİNİ
  // Türkçeye taşımıştı ('ADMIN' → 'YÖNETİCİ' vb.) — bağımsız kontrol bunun bir TEL
  // PROTOKOLÜ kırılması olduğunu ölçtü (`collmind.frontend`'in aynı enum'u ASCII
  // taşıması, `hasRole`'ün birebir string eşitliğiyle çalışması → her rol kapılı rota
  // her kullanıcı için reddediliyordu). Karar: enum DEĞERLERİ ASCII kalır; Türkçe rol
  // adı (K-2.6.4) bir GÖRÜNTÜ eşlemesidir, şema/tel değeri değil (`K-2.2.7`'nin
  // renk/davranış ayrımının RBAC karşılığı). Bkz. `user.entity.ts` üst yorumu.
  // ────────────────────────────────────────────────────────────────────────────────
  private async applyR2aUserRoleEnum(queryRunner: QueryRunner): Promise<void> {
    // K-2.6.4d: "önce sayılır, sonra silinir." Donmuş eşleme (EK_C § R2), 2026-08-13.
    const REMOVED_ROLES = ['APPROVER', 'MANAGER', 'FINANCE'] as const;
    const [{ cnt: removedRoleUsers }]: [{ cnt: number }] =
      await queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM "main"."users" WHERE "role"::text = ANY($1::text[]);`,
        [REMOVED_ROLES],
      );
    if (removedRoleUsers !== 0) {
      throw new Error(
        `B dalgası / R2a ASSERT başarısız: main.users'ta silinecek rollerden (${REMOVED_ROLES.join(
          ', ',
        )}) birini taşıyan ${removedRoleUsers} kullanıcı var (0 bekleniyordu, ölçüldü ` +
          `2026-08-13). Enum daraltılamaz — Migration İPTAL edildi. Team Lead'e bildir; ` +
          `bu kullanıcıların yeni role'ü ürün sahibi kararı gerektirir, ajan varsaymaz.`,
      );
    }

    // Silme + yeniden adlandırma TEK adımda (yeni tip + dönüşüm, Postgres notu,
    // T-211): eski jenerik 'FINANCE' (0 kullanıcı, yukarıdaki assert'te sayıldı) ve
    // eski 'FINANCE_MANAGER' etiketi AYNI ANDA işlenir — hedef tip yalnız 5 değer
    // taşıdığı için (aşağı) "önce sil sonra adlandır" sırası burada bir SQL kısıtı
    // değil (RENAME VALUE'nün aksine, iki adımlı bir ALTER TYPE dizisi değiliz);
    // yine de doğru davranışı garanti eden şey CASE eşlemesinin STATIC ve TAM
    // olması — aşağıdaki beş dal dışında hiçbir eski değer (assert'le 0 olduğu
    // kanıtlanmış) hedefe erişemez.
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" RENAME TO "users_role_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."users_role_enum" AS ENUM (
        'ADMIN', 'PLANNER', 'CATEGORY_MANAGER', 'FINANCE', 'READONLY'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users"
      ALTER COLUMN "role" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users"
      ALTER COLUMN "role" TYPE "main"."users_role_enum"
      USING (
        CASE "role"::text
          WHEN 'ADMIN' THEN 'ADMIN'
          WHEN 'PLANNER' THEN 'PLANNER'
          WHEN 'CATEGORY_MANAGER' THEN 'CATEGORY_MANAGER'
          WHEN 'FINANCE_MANAGER' THEN 'FINANCE'
          WHEN 'READONLY' THEN 'READONLY'
          -- §2.5 (sessiz sıfır yasağı) / review S3: bu dala ASLA düşülmemeli — yukarıdaki
          -- ASSERT zaten APPROVER/MANAGER/(eski)FINANCE'ı 0'a getirdi, ve enum'un geri
          -- kalan tek değeri yok. Yine de sessiz NULL yerine kaynak değeri taşıyan,
          -- hedef enum'da OLMAYAN bir sentinel döndürür — cast anında Postgres'in kendi
          -- "invalid input value for enum" hatası hangi değerin kaçtığını adıyla basar.
          ELSE 'UNMAPPED_ROLE:' || "role"::text
        END
      )::"main"."users_role_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users"
      ALTER COLUMN "role" SET DEFAULT 'PLANNER';
    `);
    await queryRunner.query(`DROP TYPE "main"."users_role_enum_old";`);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // R3 — skus.unit_of_measure KALDIRILIR, yerine S12 (K-2.1.12b, K-2.1.12c)
  //
  // ⚠️ ÖLÇÜM SINIRI (code-reviewer B4, 2026-08-13): `R1`/`R2a`'nın aksine bu çıkarma
  // ÖN SAYIM YAPMAZ — kaç satırda `unit_of_measure` dolu olduğu, hangi değerleri
  // taşıdığı ÖLÇÜLMEDİ ve kolon düştükten sonra bir daha ÖLÇÜLEMEZ. `down()` kolonu
  // geri verir, VERİYİ vermez (aşağı). Bir sonraki okuyucu bunu `R1`/`R2a` gibi
  // assert'li sansın — DEĞİL. Kayıp miktarı bilinmiyor.
  // ────────────────────────────────────────────────────────────────────────────────
  private async applyR3DropSkuUnitOfMeasure(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."skus" DROP COLUMN "unit_of_measure";
    `);
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // DOWN — tek geri dönüş noktası, TERS SIRA (7→1)
  // ══════════════════════════════════════════════════════════════════════════════════
  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── R3'ün tersi ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "main"."skus" ADD COLUMN "unit_of_measure" character varying(20);
    `);

    // ── R2a'nın tersi ────────────────────────────────────────────────────────────
    // review S4: up() bir JS-seviyeli ASSERT'le başlıyordu (removedRoleUsers), down()
    // hiçbir pre-check olmadan direkt ALTER'a giriyordu — asimetrik. Widening (5→8)
    // veri kaybı riski taşımaz, ama disiplin simetrik olsun diye aynı desende: kaynak
    // enum'un TAMAMEN 5 değerden ibaret olduğunu (yani up()'un ürettiği hâl dışında bir
    // şey olmadığını) doğrula.
    // ⚠️ Ölçüldü: `array_agg(...)` sonucunu TypeORM/pg driver'ın `name[]` için JS array'e
    // PARSE ETMEDİĞİ görüldü (`currentLabels.filter is not a function` — runtime'da
    // yakalandı, bu satırın kendisi §2.7'nin "mutasyon/ölçüm doğrulaması" dersinin bir
    // vakası). Basit `SELECT COUNT(*)` deseni (bu dosyada zaten kanıtlanmış) kullanılıyor.
    const EXPECTED_UP_LABELS = [
      'ADMIN',
      'PLANNER',
      'CATEGORY_MANAGER',
      'FINANCE',
      'READONLY',
    ];
    const [{ cnt: unexpectedCount }]: [{ cnt: number }] =
      await queryRunner.query(
        `
        SELECT COUNT(*)::int AS cnt
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'main' AND t.typname = 'users_role_enum'
          AND e.enumlabel::text != ALL($1::text[]);
      `,
        [EXPECTED_UP_LABELS],
      );
    if (unexpectedCount !== 0) {
      throw new Error(
        `B dalgası down() ASSERT başarısız: main.users_role_enum ${unexpectedCount} ` +
          `beklenmeyen etiket taşıyor — up()'un ürettiği 5 değerden başka bir şey var. ` +
          `down() İPTAL edildi, Team Lead'e bildir.`,
      );
    }
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" RENAME TO "users_role_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."users_role_enum" AS ENUM (
        'ADMIN', 'PLANNER', 'APPROVER', 'FINANCE', 'FINANCE_MANAGER',
        'CATEGORY_MANAGER', 'MANAGER', 'READONLY'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users" ALTER COLUMN "role" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users"
      ALTER COLUMN "role" TYPE "main"."users_role_enum"
      USING (
        CASE "role"::text
          WHEN 'ADMIN' THEN 'ADMIN'
          WHEN 'PLANNER' THEN 'PLANNER'
          WHEN 'CATEGORY_MANAGER' THEN 'CATEGORY_MANAGER'
          WHEN 'FINANCE' THEN 'FINANCE_MANAGER'
          WHEN 'READONLY' THEN 'READONLY'
          -- Simetrik güvenlik (review S3) — yapısal olarak erişilemez (kaynak tip
          -- yalnız bu 5 değeri taşıyabilir), ama sessiz NULL yerine adlı sentinel.
          ELSE 'UNMAPPED_ROLE:' || "role"::text
        END
      )::"main"."users_role_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."users" ALTER COLUMN "role" SET DEFAULT 'PLANNER';
    `);
    await queryRunner.query(`DROP TYPE "main"."users_role_enum_new";`);

    // ── R1'in tersi ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries" ADD COLUMN "deleted_at" TIMESTAMP;
    `);
    // v_budget_summary'yi orijinal (le.deleted_at IS NULL filtreli) hâline döndür —
    // kolon artık var, `1789000000000`'un metniyle birebir aynı SQL.
    await queryRunner.query(this.vBudgetSummaryViewSql(true));

    // ── CHECK'lerin tersi ────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries" DROP CONSTRAINT "CHK_ledger_entries_amount_non_negative";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries" DROP CONSTRAINT "CHK_ledger_entries_adjustment_subtype_bidirectional";
    `);

    // ── Backfill (b)'nin tersi ───────────────────────────────────────────────────
    // ⛔ B1: FK'ler bu migration'da hiç eklenmedi (yukarı) — düşürecek bir FK yok.
    // fiscal_periods'un backfill'i geri alınmaz — tablo bir sonraki adımda tamamen
    // düşer, satır düzeyinde geri almaya gerek yok.

    // ── Backfill (a)'nın tersi ───────────────────────────────────────────────────
    // ⚠️ Geri alınmaz: hangi satırların bu migration tarafından REVERSAL ile
    // işaretlendiği (aksine önceden başka bir yolla işaretlenmiş olabileceği) bu
    // migration'da ayrıca İZLENMİYOR. Bu ortamda 0 satır etkilendiği için (yukarı,
    // backfillLedgerReversalSubtype yorumu) veri kaybı riski YOK; farklı bir ortamda
    // aşağıdaki `adjustment_subtype` kolonunun DROP edilmesi bu veriyi zaten siler.

    // ── S10'un tersi ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries" DROP COLUMN "adjustment_subtype";
    `);
    await queryRunner.query(
      `DROP TYPE "main"."ledger_adjustment_subtype_enum";`,
    );

    await queryRunner.query(`
      ALTER TYPE "main"."ledger_entries_spend_type_enum" RENAME TO "ledger_entries_spend_type_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."ledger_entries_spend_type_enum" AS ENUM ('ON_INVOICE', 'OFF_INVOICE', 'ADJUSTMENT', 'ACCRUAL');
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
      ALTER COLUMN "spend_type" TYPE "main"."ledger_entries_spend_type_enum"
      USING "spend_type"::text::"main"."ledger_entries_spend_type_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "main"."ledger_entries_spend_type_enum_new";`,
    );

    // budget_transactions.tx_type: ACCRUE/CONSUME ÇIKAR — tip değişimiydi (ADD VALUE
    // DEĞİL), tam geri alınabilir. 3-yollu assert.
    const [{ cnt: newTxTypeUsers }]: [{ cnt: number }] =
      await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt FROM "main"."budget_transactions" WHERE "tx_type"::text IN ('ACCRUE', 'CONSUME');
    `);
    if (newTxTypeUsers !== 0) {
      throw new Error(
        `B dalgası down() ASSERT başarısız: main.budget_transactions'ta tx_type ` +
          `ACCRUE/CONSUME taşıyan ${newTxTypeUsers} satır var (0 bekleniyordu) — bu ` +
          `migration'ın kapsamı dışında yazılmış olmalı. down() İPTAL edildi.`,
      );
    }
    // Aynı view bağımlılığı (yukarı, up() yorumu) — down()'da da geçerli. Bu noktada
    // ledger_entries.deleted_at ZATEN geri geldi (R1'in tersi bu bloktan önce çalıştı),
    // yani view'ı orijinal (filtreli, `true`) hâliyle yeniden yaratmak doğru.
    await queryRunner.query(`DROP VIEW "main"."v_budget_summary";`);
    await queryRunner.query(`
      ALTER TYPE "main"."budget_transactions_tx_type_enum" RENAME TO "budget_transactions_tx_type_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."budget_transactions_tx_type_enum" AS ENUM (
        'ALLOCATE', 'COMMIT', 'RESERVE', 'RELEASE', 'TRANSFER', 'ADJUST'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."budget_transactions"
      ALTER COLUMN "tx_type" TYPE "main"."budget_transactions_tx_type_enum"
      USING "tx_type"::text::"main"."budget_transactions_tx_type_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "main"."budget_transactions_tx_type_enum_new";`,
    );
    await queryRunner.query(this.vBudgetSummaryViewSql(true));

    // plans.status: EXPIRED ÇIKAR — aynı desen.
    const [{ cnt: expiredPlans }]: [{ cnt: number }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS cnt FROM "main"."plans" WHERE "status"::text = 'EXPIRED';
    `);
    if (expiredPlans !== 0) {
      throw new Error(
        `B dalgası down() ASSERT başarısız: main.plans'ta status='EXPIRED' taşıyan ` +
          `${expiredPlans} satır var (0 bekleniyordu). down() İPTAL edildi.`,
      );
    }
    await queryRunner.query(`
      ALTER TYPE "main"."plans_plan_status_enum" RENAME TO "plans_plan_status_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."plans_plan_status_enum" AS ENUM (
        'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PENDING_FINANCE_REVIEW'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans" ALTER COLUMN "status" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans"
      ALTER COLUMN "status" TYPE "main"."plans_plan_status_enum"
      USING "status"::text::"main"."plans_plan_status_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plans" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
    `);
    await queryRunner.query(`DROP TYPE "main"."plans_plan_status_enum_new";`);

    // ── Yeni alanların (S1/S2/S9/S12/S14) tersi ──────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "main"."sales_actuals" DROP CONSTRAINT "CHK_sales_actuals_volume_non_negative";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."sales_actuals"
      DROP COLUMN "fu_id",
      DROP COLUMN "sku_id",
      DROP COLUMN "volume",
      DROP COLUMN "raw_volume_input",
      DROP COLUMN "volume_conversion_factor";
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."skus" DROP CONSTRAINT "CHK_skus_conversion_factor_positive";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."skus"
      DROP COLUMN "sales_unit",
      DROP COLUMN "conversion_factor";
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_entries" DROP CONSTRAINT "FK_on_invoice_entries_agreement";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_entries" DROP COLUMN "agreement_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."on_invoice_batches" DROP COLUMN "file_content_hash";
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."mechanics" DROP CONSTRAINT "CHK_mechanics_max_duration_days_positive";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."mechanics"
      DROP COLUMN "evidence_class",
      DROP COLUMN "settlement_cadence",
      DROP COLUMN "accrual_schedule",
      DROP COLUMN "base",
      DROP COLUMN "max_duration_days";
    `);
    await queryRunner.query(`DROP TYPE "main"."mechanic_base_enum";`);
    await queryRunner.query(`DROP TYPE "main"."accrual_schedule_enum";`);
    await queryRunner.query(`DROP TYPE "main"."settlement_cadence_enum";`);
    // ⚠️ `evidence_class_enum` BURADA DÜŞÜRÜLMEZ — `tactic_realizations.evidence_class`
    // (S8) hâlâ kullanıyor. Sıra (up()'un aynası, S8 tabloları S1 alanlarından ÖNCE
    // yaratıldığı için down'da SONRA düşer) aşağıda; tip orada düşer.

    // ── Yeni tabloların (S8/S7/S6/S5/S4) tersi ───────────────────────────────────
    await queryRunner.query(`DROP TABLE "main"."tactic_realizations";`);
    await queryRunner.query(`DROP TYPE "main"."evidence_class_enum";`);
    await queryRunner.query(`DROP TABLE "main"."claim_matches";`);
    await queryRunner.query(
      `DROP TYPE "main"."claim_match_variance_class_enum";`,
    );

    await queryRunner.query(`DROP TABLE "main"."claims";`);
    await queryRunner.query(`DROP TYPE "main"."claim_status_enum";`);
    await queryRunner.query(`DROP TYPE "main"."claim_source_enum";`);

    await queryRunner.query(`DROP TABLE "main"."user_role_assignments";`);
    await queryRunner.query(`DROP TABLE "main"."role_capabilities";`);
    await queryRunner.query(`DROP TABLE "main"."capabilities";`);
    await queryRunner.query(`DROP TABLE "main"."roles";`);

    await queryRunner.query(`
      ALTER TABLE "main"."approval_requests" DROP CONSTRAINT "FK_approval_requests_approval_policy";
    `);
    await queryRunner.query(`DROP TABLE "main"."approval_policies";`);
    await queryRunner.query(
      `DROP TYPE "main"."approval_policy_template_enum";`,
    );

    await queryRunner.query(`DROP TABLE "main"."budget_policies";`);
    await queryRunner.query(
      `DROP TYPE "main"."budget_policy_finance_review_mode_enum";`,
    );

    // ── donemler (fiscal_periods) tablosunun tersi ───────────────────────────────
    await queryRunner.query(`DROP TABLE "main"."fiscal_periods";`);
    await queryRunner.query(`DROP TYPE "main"."fiscal_period_status_enum";`);
  }
}
