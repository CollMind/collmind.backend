import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Notification,
  NotificationChannel,
} from '../../../database/entities/notification.entity';

/**
 * MC-002: Email Service for Notifications
 *
 * This service handles email sending for notifications.
 * Currently uses console logging as placeholder.
 * In production, integrate with email service provider (SendGrid, AWS SES, etc.)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendEmail(notification: Notification): Promise<boolean> {
    if (notification.channel !== NotificationChannel.EMAIL) {
      return false;
    }

    try {
      // TODO: Integrate with email service provider
      // Example: SendGrid, AWS SES, Nodemailer, etc.

      // For now, log the email
      this.logger.log({
        to: notification.recipientEmail,
        subject: notification.subject,
        body: notification.body,
        type: notification.type,
        priority: notification.priority,
      });

      // In production, implement actual email sending:
      // await this.emailProvider.send({
      //   to: notification.recipientEmail,
      //   subject: notification.subject,
      //   html: this.formatEmailBody(notification),
      // });

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send email for notification ${notification.id}:`,
        error,
      );
      return false;
    }
  }

  private formatEmailBody(notification: Notification): string {
    // Format notification body as HTML email
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
            .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>CollMind TPM Platform</h1>
            </div>
            <div class="content">
              <h2>${notification.subject}</h2>
              <div>${notification.body.replace(/\n/g, '<br>')}</div>
            </div>
            <div class="footer">
              <p>This is an automated notification from CollMind TPM Platform.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  async sendBulkEmails(
    notifications: Notification[],
  ): Promise<{ success: number; failed: number }> {
    const results = await Promise.allSettled(
      notifications.map((notification) => this.sendEmail(notification)),
    );

    const success = results.filter(
      (r) => r.status === 'fulfilled' && r.value,
    ).length;
    const failed = results.length - success;

    return { success, failed };
  }
}
