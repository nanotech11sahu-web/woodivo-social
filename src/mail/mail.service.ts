import { Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';

export interface FailureNotification {
  jobId: string;
  folderName: string;
  stage: string;
  reason: string;
  attempts: number;
  occurredAt: Date;
}

/**
 * Sends failure notifications via SMTP. A misconfigured or unreachable mail
 * server never throws out of this service - it logs and returns, so a
 * notification failure can never cascade into blocking the scheduler.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MailService.name);

    if (!this.appConfig.mail.host || !this.appConfig.mail.to) {
      this.logger.warn(
        'SMTP_HOST or MAIL_TO not configured - failure email notifications are disabled',
      );
      this.transporter = null;
      return;
    }

    this.transporter = createTransport({
      host: this.appConfig.mail.host,
      port: this.appConfig.mail.port,
      secure: this.appConfig.mail.secure,
      auth: this.appConfig.mail.user
        ? { user: this.appConfig.mail.user, pass: this.appConfig.mail.pass }
        : undefined,
    });
  }

  async sendFailureNotification(notification: FailureNotification): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(notification, 'Mail transport unavailable, skipping failure notification');
      return;
    }

    const subject = `[Woodivo Social Publisher] Post failed: ${notification.folderName}`;
    const text = [
      `A post failed to publish and requires manual attention.`,
      ``,
      `Job ID: ${notification.jobId}`,
      `Folder: ${notification.folderName}`,
      `Failed stage: ${notification.stage}`,
      `Attempts: ${notification.attempts}`,
      `Occurred at: ${notification.occurredAt.toISOString()}`,
      ``,
      `Reason:`,
      notification.reason,
      ``,
      `The post has been moved to the "failed" folder for review.`,
    ].join('\n');

    try {
      await this.transporter.sendMail({
        from: this.appConfig.mail.from,
        to: this.appConfig.mail.to,
        subject,
        text,
      });
      this.logger.info({ jobId: notification.jobId }, 'Failure notification email sent');
    } catch (error) {
      this.logger.error(
        { jobId: notification.jobId, error: (error as Error).message },
        'Failed to send failure notification email',
      );
    }
  }
}
