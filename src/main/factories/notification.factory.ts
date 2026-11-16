import { INotificationService } from '@domain/services/notification.service';
import { NodemailerNotificationService } from '@infrastructure/notifications/nodemailer-notification.service';
import { SesNotificationService } from '@infrastructure/notifications/ses-notification.service';

/** `NOTIFICATION_PROVIDER=ses` | `smtp` (default) — ADR-005. */
export const makeNotificationService = (): INotificationService =>
  process.env.NOTIFICATION_PROVIDER === 'ses'
    ? new SesNotificationService()
    : new NodemailerNotificationService();
