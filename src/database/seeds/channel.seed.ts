import { DataSource } from 'typeorm';
import { Channel } from '../entities/channel.entity';

export async function seedChannels(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<Channel[]> {
  const channelRepository = dataSource.getRepository(Channel);

  const channels = [
    {
      code: 'NKA',
      name: 'National Key Accounts',
      description: 'National Key Accounts channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 1,
      isActive: true,
    },
    {
      code: 'TRADITIONAL_TRADE',
      name: 'Traditional Trade',
      description: 'Traditional Trade channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 2,
      isActive: true,
    },
    {
      code: 'E_COMMERCE',
      name: 'E-Commerce',
      description: 'E-Commerce channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 3,
      isActive: true,
    },
    {
      code: 'EXPORT',
      name: 'Export',
      description: 'Export channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 4,
      isActive: true,
    },
    {
      code: 'WHOLESALE',
      name: 'Wholesale',
      description: 'Wholesale channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 5,
      isActive: true,
    },
    {
      code: 'RETAIL',
      name: 'Retail',
      description: 'Retail channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 6,
      isActive: true,
    },
    {
      code: 'HORECA',
      name: 'HORECA',
      description: 'Hotel, Restaurant, Cafe channel',
      tenantId,
      createdBy: createdByUserId,
      sortOrder: 7,
      isActive: true,
    },
  ];

  const created: Channel[] = [];
  for (const channelData of channels) {
    const existing = await channelRepository.findOne({
      where: { tenantId: channelData.tenantId, code: channelData.code },
    });

    if (!existing) {
      const channel = channelRepository.create(channelData);
      created.push(await channelRepository.save(channel));
      console.log(`✅ Created channel: ${channel.name} (${channel.code})`);
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} channels`);
  return created;
}
