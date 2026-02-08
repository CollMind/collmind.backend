import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Notification, NotificationStatus } from '../../database/entities/notification.entity';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(notification: Partial<Notification>): Promise<Notification> {
    const newNotification = this.notificationRepository.create(notification);
    return this.notificationRepository.save(newNotification);
  }

  async findById(tenantId: string, id: string): Promise<Notification | null> {
    return this.notificationRepository.findOne({
      where: { tenantId, id },
    });
  }

  async findByRecipient(tenantId: string, recipientId: string, limit = 30): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { tenantId, recipientId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findUnreadByRecipient(tenantId: string, recipientId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: {
        tenantId,
        recipientId,
        status: Not(NotificationStatus.READ),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async update(notification: Notification): Promise<Notification> {
    return this.notificationRepository.save(notification);
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

