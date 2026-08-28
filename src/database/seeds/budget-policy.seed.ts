/**
 * BudgetPolicy Seed — B dalgası / S4 seed item 1: "joker bütçe politikası satırı"
 * (`K-2.2.8d` — ZORUNLU, `EK_C § butce_politikalari`).
 *
 * `K-2.2.8d`: her kiracıda bir joker satır (kanal VE kategori boş) zorunludur — bu,
 * en-spesifik-kazanır çözümlemesinin fallback'idir. Sıfır satır demek, bütçe politikası
 * çözümlemesinin FALLBACK'İ YOK demek (code-reviewer, T-101'in sınıfı).
 *
 * Değerler kaynaktan (`EK_C § butce_politikalari`, `K-2.2.8a`–`d`): uyarı eşiği 80,
 * finans inceleme eşiği 90, blok eşiği 100, finans inceleme modu BİLDİRİM/NOTIFY —
 * dördü de migration'ın kendi kolon `DEFAULT`'ları (bkz. `1803000000000`), burada
 * TEKRAR YAZILMIYOR (tek kaynak — `K-2.3.10` ilkesiyle aynı disiplin).
 *
 * İdempotent: `UQ_budget_policies_tenant_channel_category` (`NULLS NOT DISTINCT`) üzerinden
 * `ON CONFLICT DO NOTHING`.
 *
 * ⛔ T-316 (`Z57 §1a`): joker satır zaten VARSA ama değerleri kanonik
 * varsayılandan (80/90/100/NOTIFY) SAPMIŞSA — ölçüldü, canlı DB'de
 * `50.00/60.00/70.00` bulundu — bu bir INSERT-skip ile bırakılamaz. `%90`
 * pini bugün canlansaydı yanlış sayıyı okurdu. Bu yüzden mevcut joker satır
 * kanonik değerlerden SAPMIŞSA açıkça UPDATE edilir (migration DEĞİL — şema
 * değişmiyor, yalnız veri; bu task'ın `migration_seq`'i yok ve gerekmiyor).
 */
import { DataSource, IsNull } from 'typeorm';
import { BudgetPolicy } from '../entities/budget-policy.entity';
import { parseFiniteOnRead } from '../transformers/decimal.transformer';

/** `K-2.2.8` görüşlü varsayılanı — migration `1803000000000`'in kolon
 * `DEFAULT`'larıyla BİREBİR (tek kaynak burada TEKRARLANIR çünkü reconcile
 * yolu, INSERT'in aksine, DB DEFAULT'una güvenemez — UPDATE açık değer ister).
 */
const CANONICAL_WARNING_PCT = 80;
const CANONICAL_FINANCE_REVIEW_PCT = 90;
const CANONICAL_BLOCK_PCT = 100;
const CANONICAL_FINANCE_REVIEW_MODE = 'NOTIFY' as const;

// `parseFiniteOnRead` (`../transformers/decimal.transformer`): aynı
// finite/NaN/Infinity koruması `DecimalTransformer.from`'un kullandığı —
// bu üç kolon `Alan B` (transformer'sız, ADR 0007 Karar 1/2, `T-228`
// kataloglu) olduğu için ham `Number()` yerine burada da bu okunur.
function readPct(raw: number): number {
  const parsed = parseFiniteOnRead(raw as unknown as string);
  if (parsed === null || parsed === undefined) {
    throw new Error(
      'BudgetPolicy eşik kolonu okunamadı (null/undefined) — beklenmeyen sürücü değeri',
    );
  }
  return parsed;
}

/**
 * ⛔ `T-316` review (Team Lead, 2026-08-28) — reconcile ÖLÇÜLMÜŞ SAPMAYA DARALTILDI.
 *
 * İlk hâli *"kanonikten farklı olan her şeyi"* üzerine yazıyordu. Bu, `Z57 §1a`'nın
 * istediğinden GENİŞ ve `K-2.2.8`'e aykırı: eşikler **konfigürasyondur** — bir
 * kiracının bilinçli `85/95` ayarı, `npm run seed` her koştuğunda **sessizce**
 * `80/90/100`'e dönerdi.
 *
 * ⇒ `DISIPLIN`: *"bir DÜZELTME, düzelttiği SINIFIN yeni bir vakasını üretebilir"* —
 *   sessiz-yanlış-değer, **sessiz-üstüne-yazma** ile kapatılamaz.
 *
 * Üç durum ayrılır (migration'ların `1805`+ deseninin seed hâli):
 *   ölçülmüş eski varsayılan (`50/60/70`) → RECONCILE
 *   kanonik                                → NO-OP
 *   BAŞKA herhangi bir değer               → ⛔ DOKUNMA + görünür UYARI
 *                                            (kiracı konfigürasyonu olabilir)
 */
const LEGACY_DEFAULTS = { warning: 50, financeReview: 60, block: 70 } as const;

type JokerState = 'canonical' | 'legacy' | 'foreign';

function classifyJoker(joker: BudgetPolicy): JokerState {
  const w = readPct(joker.warningThresholdPct);
  const f = readPct(joker.financeReviewThresholdPct);
  const b = readPct(joker.blockThresholdPct);
  if (
    w === CANONICAL_WARNING_PCT &&
    f === CANONICAL_FINANCE_REVIEW_PCT &&
    b === CANONICAL_BLOCK_PCT &&
    joker.financeReviewMode === CANONICAL_FINANCE_REVIEW_MODE
  ) {
    return 'canonical';
  }
  if (
    w === LEGACY_DEFAULTS.warning &&
    f === LEGACY_DEFAULTS.financeReview &&
    b === LEGACY_DEFAULTS.block
  ) {
    return 'legacy';
  }
  return 'foreign';
}

export async function seedBudgetPolicies(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<void> {
  const repo = dataSource.getRepository(BudgetPolicy);

  // ⚠️ `{ channelId: undefined }` TypeORM'da alanı WHERE'den ÇIKARIR, `IS NULL` üretmez
  // — `IsNull()` şart, yoksa "joker var mı" sorusu yanlış cevaplanır (herhangi bir satır
  // varlığını "joker var" sanar).
  const existingJoker = await repo.findOne({
    where: { tenantId, channelId: IsNull(), categoryId: IsNull() },
  });
  if (existingJoker) {
    const state = classifyJoker(existingJoker);
    if (state === 'canonical') {
      console.log(
        '   BudgetPolicies: 0 inserted (joker already present, canonical)',
      );
      return;
    }
    if (state === 'foreign') {
      // ⛔ DOKUNMA. `K-2.2.8`: eşikler KONFİGÜRASYONDUR. Ne olduğunu bilmediğimiz
      // bir değeri varsayılana çekmek, `§2.5`'in yasakladığı GİZLİ TIE-BREAK'tir.
      console.warn(
        `   BudgetPolicies: 0 inserted — joker ne kanonik ne de ölçülmüş eski ` +
          `varsayılan (${readPct(existingJoker.warningThresholdPct)}/` +
          `${readPct(existingJoker.financeReviewThresholdPct)}/` +
          `${readPct(existingJoker.blockThresholdPct)}/` +
          `${existingJoker.financeReviewMode}). DOKUNULMADI — kiracı ` +
          `konfigürasyonu olabilir (K-2.2.8).`,
      );
      return;
    }
    // T-316 (`Z57 §1a`): sapma ölçüldü ve düzeltilmesi ŞART koşuldu — sessizce
    // bırakmak §2.5 ihlalidir (yanlış eşik, doğru göründüğü için tehlikelidir).
    const before = {
      warning: existingJoker.warningThresholdPct,
      financeReview: existingJoker.financeReviewThresholdPct,
      block: existingJoker.blockThresholdPct,
      mode: existingJoker.financeReviewMode,
    };
    await repo.update(
      { id: existingJoker.id },
      {
        warningThresholdPct: CANONICAL_WARNING_PCT,
        financeReviewThresholdPct: CANONICAL_FINANCE_REVIEW_PCT,
        blockThresholdPct: CANONICAL_BLOCK_PCT,
        financeReviewMode: CANONICAL_FINANCE_REVIEW_MODE,
      },
    );
    console.log(
      `   BudgetPolicies: 1 RECONCILED (ölçülmüş eski varsayılan: ` +
        `${JSON.stringify(before)} → 80/90/100/NOTIFY)`,
    );
    return;
  }

  const result = await dataSource
    .createQueryBuilder()
    .insert()
    .into(BudgetPolicy)
    .values({ tenantId, createdBy: createdByUserId })
    .orIgnore()
    .execute();

  // review S7 emsali: `.orIgnore()` ile `identifiers.length` girdi satırlarından
  // dolar, gerçek `RETURNING`'den değil (ampirik ölçüldü, fiscal-period.seed.ts'e
  // bkz.) — `raw.length` kullanılıyor. Buradaki pre-check (yukarı) normal koşuda
  // bu satıra hiç yanlış bir "1" düşürtmez, ama ölçüm disiplini aynı kalsın.
  console.log(`   BudgetPolicies: ${result.raw.length} inserted (joker satır)`);
}
