import { DataSource } from 'typeorm';
import {
  BudgetAlertConfiguration,
  AlertLevel,
  NotificationChannel,
} from '../entities/budget-alert-configuration.entity';

/**
 * Seeds the three canonical BudgetAlertConfiguration rows for a tenant.
 * T-012 — config-driven threshold: thresholdPercent is the authoritative value.
 */
export async function seedBudgetAlertConfigurations(
  dataSource: DataSource,
  tenantId: string,
): Promise<BudgetAlertConfiguration[]> {
  const repo = dataSource.getRepository(BudgetAlertConfiguration);

  const configs = [
    {
      tenantId,
      alertLevel: AlertLevel.WARNING_80,
      thresholdPercent: 80,
      notificationChannels: [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ],
      isActive: true,
    },
    {
      tenantId,
      alertLevel: AlertLevel.CRITICAL_95,
      thresholdPercent: 95,
      notificationChannels: [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ],
      isActive: true,
    },
    {
      tenantId,
      alertLevel: AlertLevel.EXCEEDED_100,
      thresholdPercent: 100,
      notificationChannels: [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
      ],
      isActive: true,
    },
  ];

  const created: BudgetAlertConfiguration[] = [];
  for (const config of configs) {
    const existing = await repo.findOne({
      where: { tenantId, alertLevel: config.alertLevel },
    });

    if (!existing) {
      const entity = repo.create(config);
      created.push(await repo.save(entity));
    } else {
      // Idempotent: ensure thresholdPercent is up-to-date
      if (Number(existing.thresholdPercent) !== config.thresholdPercent) {
        existing.thresholdPercent = config.thresholdPercent;
        created.push(await repo.save(existing));
      } else {
        created.push(existing);
      }
    }
  }

  console.log(
    `Seeded ${created.length} budget alert configurations for tenant ${tenantId}`,
  );
  return created;
}
