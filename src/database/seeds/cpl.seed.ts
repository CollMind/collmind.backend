import { DataSource } from 'typeorm';
import { Cpl } from '../entities/cpl.entity';
import { Channel } from '../entities/channel.entity';

export async function seedCpls(
  dataSource: DataSource,
  tenantId: string,
  channelId: string,
  createdByUserId: string,
): Promise<Cpl[]> {
  const cplRepository = dataSource.getRepository(Cpl);
  const channelRepository = dataSource.getRepository(Channel);

  // Get channel to ensure it exists
  const channel = await channelRepository.findOne({ where: { id: channelId, tenantId } });
  if (!channel) {
    throw new Error(`Channel with ID ${channelId} not found`);
  }

  const cpls = [
    {
      code: 'CPL-NKA-001',
      name: 'Migros NKA',
      channelId,
      status: 'ACTIVE' as const,
      tenantId,
      createdBy: createdByUserId,
    },
    {
      code: 'CPL-NKA-002',
      name: 'CarrefourSA NKA',
      channelId,
      status: 'ACTIVE' as const,
      tenantId,
      createdBy: createdByUserId,
    },
    {
      code: 'CPL-NKA-003',
      name: 'Metro Türkiye NKA',
      channelId,
      status: 'ACTIVE' as const,
      tenantId,
      createdBy: createdByUserId,
    },
  ];

  const created: Cpl[] = [];
  for (const cplData of cpls) {
    const existing = await cplRepository.findOne({
      where: { tenantId: cplData.tenantId, code: cplData.code },
    });

    if (!existing) {
      const cpl = cplRepository.create(cplData);
      created.push(await cplRepository.save(cpl));
      console.log(`✅ Created CPL: ${cpl.name} (${cpl.code})`);
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} CPLs`);
  return created;
}
