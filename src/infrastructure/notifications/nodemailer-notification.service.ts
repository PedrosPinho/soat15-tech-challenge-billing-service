import nodemailer, { Transporter } from 'nodemailer';
import {
  INotificationService,
  OrcamentoDisponivelEmail,
} from '@domain/services/notification.service';
import { assuntoOrcamento, corpoOrcamento } from './email-template';

export class NodemailerNotificationService implements INotificationService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    this.from = process.env.SMTP_FROM ?? 'no-reply@oficina.com';
  }

  async enviarOrcamentoDisponivel(
    destinatario: string,
    dados: OrcamentoDisponivelEmail,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: destinatario,
      subject: assuntoOrcamento(dados),
      text: corpoOrcamento(dados),
    });
  }
}
