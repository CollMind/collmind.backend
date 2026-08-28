import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, Not } from 'typeorm';
import {
  Notification,
  NotificationStatus,
} from '../../database/entities/notification.entity';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  /**
   * `T-322` (`Z59 §5i`): `manager` verilirse (çağıran hâlâ açık bir
   * QueryRunner transaction'ı içindeyse) yazım O manager üzerinden yapılır
   * — aksi hâlde bildirim kendi bağlantısını kullanır ve dış transaction
   * ROLLBACK olduğunda GERİDE KALIR (yanlış-pozitif finansal uyarı, "500'den
   * sinsi" ailesi). Desen `budget-tier-notification.service.ts
   * #evaluateAndNotify`'daki `manager?: EntityManager` ile AYNI — yeni bir
   * mekanizma icat edilmedi.
   */
  async create(
    notification: Partial<Notification>,
    manager?: EntityManager,
  ): Promise<Notification> {
    const repo = manager
      ? manager.getRepository(Notification)
      : this.notificationRepository;
    const newNotification = repo.create(notification);
    return repo.save(newNotification);
  }

  // T-275: `recipientId` ZORUNLU parametre — `findByRecipient`/`findUnreadByRecipient`/
  // `countUnread` kardeşleriyle AYNI şart. Tenant-scope tek başına yeterli değildi:
  // aynı tenant içindeki HERHANGİ bir kullanıcının bildirimini döndürüyordu
  // (ölçüldü: PLANNER2, ADMIN'in bildirimini `markAsRead` ile okuyup işaretleyebiliyordu).
  async findById(
    tenantId: string,
    recipientId: string,
    id: string,
  ): Promise<Notification | null> {
    return this.notificationRepository.findOne({
      where: { tenantId, recipientId, id },
    });
  }

  async findByRecipient(
    tenantId: string,
    recipientId: string,
    limit = 30,
  ): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { tenantId, recipientId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findUnreadByRecipient(
    tenantId: string,
    recipientId: string,
  ): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: {
        tenantId,
        recipientId,
        status: Not(NotificationStatus.READ),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    notification: Notification,
    manager?: EntityManager,
  ): Promise<Notification> {
    const repo = manager
      ? manager.getRepository(Notification)
      : this.notificationRepository;
    return repo.save(notification);
  }

  async countUnread(tenantId: string, recipientId: string): Promise<number> {
    return this.notificationRepository.count({
      where: {
        tenantId,
        recipientId,
        status: Not(NotificationStatus.READ),
      },
    });
  }
}
