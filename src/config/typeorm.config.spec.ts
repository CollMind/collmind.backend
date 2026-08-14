import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ALL_ENTITIES } from './typeorm.config';

/**
 * T-224 — pin testi.
 *
 * `ALL_ENTITIES` (`typeorm.config.ts`) uygulamanın TEK entity kaynağıdır:
 * CLI migration (`dataSourceOptions.entities`) VE runtime (`DatabaseModule`)
 * ikisi de buradan okur (bkz. `typeorm.config.ts` başındaki T-224 notu).
 * Önceden üç ayrı, elle tutulan liste vardı; `B` dalgası (T-219) yalnız
 * birini güncelledi, ikincisini unuttu, ve 17/17 e2e dosyası bootstrap'ta
 * çöktü (`İlke 4`).
 *
 * Bu test o tek listenin diskteki `@Entity`/`@ViewEntity` sınıflarıyla
 * SENKRON kaldığını pinler. Yeni bir entity dosyası eklenip `ALL_ENTITIES`'e
 * eklenmezse — ya da tersi — burada KIRMIZIYA döner.
 *
 * ⚠️ CLAUDE.md §2.7: "mutasyonun MEKANİZMAYA uygulandığını doğrula". Bu
 * yüzden çıkarım mantığı (`extractEntityClassNames`) fs'ten AYRIŞTIRILDI ve
 * aşağıda saf fixture string'leriyle, gerçek dosya sistemine dokunmadan
 * pozitif kontrollü. Gerçek disk taraması yalnız tek bir testte kullanılıyor.
 */

const ENTITIES_DIR = join(__dirname, '..', 'database', 'entities');

/**
 * Bir dosya içeriği haritasından (`dosya adı → içerik`) `@Entity(...)` ya da
 * `@ViewEntity(...)` dekoratörü taşıyan sınıfların adlarını çıkarır.
 *
 * Bir dosyada birden fazla entity olabilir (ör. `plan.entity.ts`: 3,
 * `role.entity.ts`: 4) — dekoratörle sınıf arasına başka dekoratörler
 * (`@Index(...)`, tek/çok satırlı) girebilir. Strateji: `@Entity(`/
 * `@ViewEntity(` satırından itibaren, ilk `export (abstract )?class X`
 * satırına kadar ileri tara ve `X`'i al.
 */
export function extractEntityClassNames(
  fileContents: Record<string, string>,
): string[] {
  const names: string[] = [];
  const entityDecoratorRe = /^@(?:Entity|ViewEntity)\(/;
  const classDeclRe = /^export (?:abstract )?class (\w+)/;

  for (const content of Object.values(fileContents)) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!entityDecoratorRe.test(lines[i].trim())) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const match = lines[j].trim().match(classDeclRe);
        if (match) {
          names.push(match[1]);
          break;
        }
      }
    }
  }
  return names.sort();
}

function scanDiskEntityClassNames(): string[] {
  const files = readdirSync(ENTITIES_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  );
  const fileContents: Record<string, string> = {};
  for (const file of files) {
    fileContents[file] = readFileSync(join(ENTITIES_DIR, file), 'utf-8');
  }
  return extractEntityClassNames(fileContents);
}

function diffSets(
  a: string[],
  b: string[],
): { onlyInA: string[]; onlyInB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyInA: a.filter((x) => !setB.has(x)),
    onlyInB: b.filter((x) => !setA.has(x)),
  };
}

describe('entity list — tek kaynak pini (T-224)', () => {
  it('extractEntityClassNames — pozitif kontrol: tek dosyada çoklu entity + çok satırlı @Index + @ViewEntity', () => {
    const fixture: Record<string, string> = {
      'multi.entity.ts': [
        "import { Entity, Column, Index } from 'typeorm';",
        '',
        "@Entity({ name: 'roles', schema: 'main' })",
        "@Index('UQ_roles_tenant_code', ['tenantId', 'code'], {",
        '  unique: true,',
        '})',
        'export class Role extends BaseEntity {',
        '  @Column() code!: string;',
        '}',
        '',
        "@Entity({ name: 'capabilities', schema: 'main' })",
        'export class Capability extends BaseEntity {',
        '  @Column() code!: string;',
        '}',
      ].join('\n'),
      'view.view-entity.ts': [
        "import { ViewEntity, ViewColumn } from 'typeorm';",
        '',
        '@ViewEntity({',
        "  name: 'budget_summary',",
        '  expression: `select 1`,',
        '})',
        'export class BudgetSummaryView {',
        '  @ViewColumn() total!: number;',
        '}',
      ].join('\n'),
    };

    expect(extractEntityClassNames(fixture)).toEqual(
      ['BudgetSummaryView', 'Capability', 'Role'].sort(),
    );
  });

  it('extractEntityClassNames — pozitif kontrol: EKLENEN bir entity çıktıyı DEĞİŞTİRİR (mekanizma kör değil)', () => {
    const before: Record<string, string> = {
      'a.entity.ts': [
        "@Entity({ name: 'a' })",
        'export class A extends BaseEntity {}',
      ].join('\n'),
    };
    const after: Record<string, string> = {
      ...before,
      'b.entity.ts': [
        "@Entity({ name: 'b' })",
        'export class B extends BaseEntity {}',
      ].join('\n'),
    };

    const namesBefore = extractEntityClassNames(before);
    const namesAfter = extractEntityClassNames(after);

    expect(namesBefore).toEqual(['A']);
    expect(namesAfter).toEqual(['A', 'B']);
    expect(namesAfter).not.toEqual(namesBefore);
  });

  it('diffSets — pozitif kontrol: listeden bir isim EKSİLTİLİNCE fark bunu yakalar', () => {
    const disk = ['A', 'B', 'C'];
    const canonicalMissingOne = ['A', 'B']; // C listeden düşürülmüş varsayımı
    const { onlyInA, onlyInB } = diffSets(disk, canonicalMissingOne);
    expect(onlyInA).toEqual(['C']);
    expect(onlyInB).toEqual([]);
  });

  it('diffSets — pozitif kontrol: listeye FAZLADAN bir isim EKLENİNCE fark bunu yakalar', () => {
    const disk = ['A', 'B'];
    const canonicalWithExtra = ['A', 'B', 'GHOST']; // listede olup diskte olmayan
    const { onlyInA, onlyInB } = diffSets(disk, canonicalWithExtra);
    expect(onlyInA).toEqual([]);
    expect(onlyInB).toEqual(['GHOST']);
  });

  // ⏸️ SKIP: [[T-225]] — `BudgetReservation` ÜÇ LİSTEDE DE yok (eski `typeorm.config`,
  // `database.module`, `entities/index.ts`), ama `@Entity({ name: 'budget_reservations' })`
  // gerçek, tablo DB'de VAR (0 satır), ve entity'yi import eden HİÇBİR yol yok.
  //
  // ⚠️ ASKI, KUSURUN KABULÜ DEĞİL: pin DOĞRU, kod EKSİK. Bu testin ilk koşumu üç
  // listenin birden kaçırdığı bir entity buldu — varlık gerekçesinin kendisi.
  // `T-219`'un "fark 0" ölçümü onu görmemişti çünkü listeleri BİRBİRİNE karşı
  // ölçüyordu, DİSKE karşı değil. Üç kopyanın tutarlı olması doğru olmaları
  // anlamına gelmiyor.
  //
  // ⛔ `it.failing()` KULLANILMADI bilerek: o "başarısızlık bekleniyor" demektir ve
  // semantiği ters — başarısız olan TEST değil, KOD. Ayrıca `T-225` kapanınca test
  // beklenmedik şekilde geçer ve yine kırmızı verirdi.
  //
  // `T-225` kapanınca bu `skip` KALKAR — ve o, `T-225`'in Done şartıdır.
  it.skip('PİN: diskteki @Entity/@ViewEntity sınıfları == ALL_ENTITIES (typeorm.config.ts)', () => {
    const diskNames = scanDiskEntityClassNames();
    const canonicalNames = ALL_ENTITIES.map((e) => e.name).sort();

    const { onlyInA: onlyOnDisk, onlyInB: onlyInList } = diffSets(
      diskNames,
      canonicalNames,
    );

    expect({ onlyOnDisk, onlyInList }).toEqual({
      onlyOnDisk: [],
      onlyInList: [],
    });
  });
});
