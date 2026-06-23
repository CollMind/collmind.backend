import { DataSource } from 'typeorm';
import { Cpl } from '../entities/cpl.entity';
import { Channel } from '../entities/channel.entity';

/**
 * CPL master data — kaynak: Wella Customer.xlsx (Kanal / Code / CPL Name).
 * Kanal -> Channel.code eşlemesi:
 *   Ulusal      -> NKA
 *   Distribütör -> DISTRIBUTOR
 *   E Ticaret   -> E_COMMERCE
 */
type Kanal = 'Ulusal' | 'Distribütör' | 'E Ticaret';

const KANAL_TO_CHANNEL_CODE: Record<Kanal, string> = {
  Ulusal: 'NKA',
  Distribütör: 'DISTRIBUTOR',
  'E Ticaret': 'E_COMMERCE',
};

const CPL_SOURCE: ReadonlyArray<{ kanal: Kanal; code: string; name: string }> = [
  { kanal: 'Ulusal', code: 'BS0501.50001', name: 'Gratis İç ve Dış Ticaret A.Ş.' },
  { kanal: 'Ulusal', code: 'BS0501.50004', name: 'A.S.Watson Güzellik ve Bakım Ürünleri Tic.A.Ş' },
  { kanal: 'Ulusal', code: 'BS0501.50005', name: 'Eve Mağazacılık A.Ş.' },
  { kanal: 'Ulusal', code: 'BS0501.50006', name: 'Dirk Rossmann Mağazacılık Tic.Ltd.Şti.' },
  { kanal: 'Ulusal', code: 'BS0501.50007', name: 'Migros Ticaret A.Ş.' },
  { kanal: 'Ulusal', code: 'BS0501.50008', name: 'Bim Birleşik Mağazalar A.Ş.' },
  { kanal: 'Ulusal', code: 'BS0501.50012', name: 'Carrefoursa Carrefour Sabancı Tic. Mekz. Anonim. Şti' },
  { kanal: 'Ulusal', code: 'BS0501.50091', name: 'File Market Mağazacılık A.Ş.' },
  { kanal: 'Distribütör', code: 'BS0502.50002', name: 'Hiz Gıda Oto.Teks.İnş.Tur.San.ve Tic.Ltd Şti.' },
  { kanal: 'Distribütör', code: 'BS0502.50015', name: 'Hamza Güneyli Gıda San Ve Tic.Ltd.Şti' },
  { kanal: 'Distribütör', code: 'BS0502.50092', name: 'Demirezen Gıda Ltd. Şti.' },
  { kanal: 'Distribütör', code: 'BS0503.50009', name: 'Kar-Dağ Karadeniz Gıda Dağ.Tem.ve Sağ.Ür.San.ve Tic.A.Ş.' },
  { kanal: 'Distribütör', code: 'BS0503.50023', name: 'Sivas Safa Toptan Gıda Tic. ve San.Ltd.Şti.' },
  { kanal: 'Distribütör', code: 'BS0504.50011', name: 'Duru İtriyat Deposu Tic ve Sanayi Aş.(Antalya)' },
  { kanal: 'Distribütör', code: 'BS0504.50022', name: 'Gıdasan İhtiyaç Maddeleri İmalat Ve Paz.A.Ş.' },
  { kanal: 'Distribütör', code: 'BS0504.50113', name: 'Duru İtriyat Deposu San.Ve Tic.A.Ş.(İzmir)' },
  { kanal: 'Distribütör', code: 'BS0505.50057', name: 'Özkarınca Koz. Tekstil Gıda Hıdavat İnş.San ve Tic.Ltd.Şti' },
  { kanal: 'Distribütör', code: 'BS0505.50078', name: 'Üç Gen Gıda  Lüks Hır.Hyv.İnş.Nak.Tic. Ve San. Lmt.' },
  { kanal: 'Distribütör', code: 'BS0505.50085', name: 'Evrensel99 Gıda İnş. Tar. Hayv. Petrol İç ve Dış Ltd. Şti.' },
  { kanal: 'Distribütör', code: 'BS0506.50088', name: 'Ak Temizlik Mad. Ev Eşyaları Gıda Mad. San.ve Tic. Ltd. Şti' },
  { kanal: 'Distribütör', code: 'BS0507.50017', name: 'Ram Company Consumer Products Sales and Distribution Ltd.' },
  { kanal: 'Distribütör', code: 'BS0508.50060', name: 'Bozkuşlar Gıda İnş. Tic. Ve San. Lmt.Şti' },
  { kanal: 'Distribütör', code: 'BS0509.50014', name: 'Değişim Tüketim ve Tarım Ürünleri Dağ. A.Ş.' },
  { kanal: 'E Ticaret', code: 'BS0510.50020', name: 'Saldos Ticaret  Anonim Şirketi' },
  { kanal: 'Distribütör', code: 'BS0513.50031', name: 'Uzuner Gıda San ve Tic.Ltd.Şti' },
  { kanal: 'Distribütör', code: 'BS0513.50109', name: 'MF Uzay Tic.Top.Satış San Ve Tic Ltd Şti' },
];

export async function seedCpls(
  dataSource: DataSource,
  tenantId: string,
  channels: Channel[],
  createdByUserId: string,
): Promise<Cpl[]> {
  const cplRepository = dataSource.getRepository(Cpl);

  // Channel.code -> id lookup (kanal eşlemesi için)
  const channelIdByCode = new Map<string, string>();
  for (const ch of channels) {
    channelIdByCode.set(ch.code, ch.id);
  }

  // Eşleme için gereken kanalların varlığını doğrula
  for (const channelCode of new Set(Object.values(KANAL_TO_CHANNEL_CODE))) {
    if (!channelIdByCode.has(channelCode)) {
      throw new Error(
        `CPL seed: required channel '${channelCode}' not found. Seed channels first.`,
      );
    }
  }

  const created: Cpl[] = [];
  for (const src of CPL_SOURCE) {
    const channelId = channelIdByCode.get(KANAL_TO_CHANNEL_CODE[src.kanal])!;

    const existing = await cplRepository.findOne({
      where: { tenantId, code: src.code },
    });

    if (existing) {
      created.push(existing);
      continue;
    }

    const cpl = cplRepository.create({
      code: src.code,
      name: src.name,
      channelId,
      status: 'ACTIVE' as const,
      tenantId,
      createdBy: createdByUserId,
    });
    created.push(await cplRepository.save(cpl));
    console.log(`✅ Created CPL: ${cpl.name} (${cpl.code}) [${src.kanal}]`);
  }

  console.log(`✅ Seeded ${created.length} CPLs`);
  return created;
}
