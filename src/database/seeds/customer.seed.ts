import { DataSource } from 'typeorm';
import {
  Customer,
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '../entities/customer.entity';
import { Cpl } from '../entities/cpl.entity';
import { Channel } from '../entities/channel.entity';

/**
 * Her CPL için bir müşteri oluşturur ve cplId ile bağlar.
 * Müşteriler CPL master-data'sından (Wella Customer.xlsx) türetilir.
 * Channel.code -> (CustomerChannel, CustomerType) eşlemesi:
 *   NKA         -> (NKA, DIRECT)
 *   DISTRIBUTOR -> (DISTRIBUTOR, DISTRIBUTOR)
 *   E_COMMERCE  -> (E_COMMERCE, DIRECT)
 */
const CHANNEL_CODE_TO_CUSTOMER: Record<
  string,
  { channel: CustomerChannel; type: CustomerType }
> = {
  NKA: { channel: CustomerChannel.NKA, type: CustomerType.DIRECT },
  DISTRIBUTOR: {
    channel: CustomerChannel.DISTRIBUTOR,
    type: CustomerType.DISTRIBUTOR,
  },
  E_COMMERCE: {
    channel: CustomerChannel.E_COMMERCE,
    type: CustomerType.DIRECT,
  },
};

export async function seedCustomers(
  dataSource: DataSource,
  tenantId: string,
  cpls: Cpl[],
  channels: Channel[],
  createdByUserId: string,
): Promise<Customer[]> {
  const customerRepository = dataSource.getRepository(Customer);

  // channelId -> code lookup
  const channelCodeById = new Map<string, string>();
  for (const ch of channels) {
    channelCodeById.set(ch.id, ch.code);
  }

  const created: Customer[] = [];
  for (const cpl of cpls) {
    const channelCode = channelCodeById.get(cpl.channelId);
    const mapping = channelCode
      ? CHANNEL_CODE_TO_CUSTOMER[channelCode]
      : undefined;
    if (!mapping) {
      console.warn(
        `⚠️  CPL ${cpl.code} kanalı (${channelCode ?? cpl.channelId}) için müşteri eşlemesi yok, atlanıyor.`,
      );
      continue;
    }

    const code = `CUST-${cpl.code}`;
    const existing = await customerRepository.findOne({
      where: { tenantId, code },
    });

    if (existing) {
      // CPL bağını garanti et (idempotent). NOT: isim/kanal değişiklikleri
      // seed tarafından otomatik güncellenmez; mevcut müşteri korunur (master
      // data elle yönetilir). Yeniden senkron gerekirse DB'de manuel güncelle.
      if (existing.cplId !== cpl.id) {
        existing.cplId = cpl.id;
        await customerRepository.save(existing);
      }
      created.push(existing);
      continue;
    }

    // Müşteri kodu CPL kodundan türetilir (CUST-<cpl.code>). cpl.code xlsx
    // kaynaklı ~12 karakter; Customer.code length=50 sınırının altında.
    const customer = customerRepository.create({
      code,
      name: cpl.name,
      channel: mapping.channel,
      type: mapping.type,
      status: CustomerStatus.ACTIVE,
      country: 'Turkey',
      currency: 'TRY',
      cplId: cpl.id,
      tenantId,
      createdBy: createdByUserId,
    });
    created.push(await customerRepository.save(customer));
    console.log(
      `✅ Created customer: ${customer.name} (${customer.code}) → CPL ${cpl.code}`,
    );
  }

  console.log(`✅ Seeded ${created.length} customers (CPL-linked)`);
  return created;
}
