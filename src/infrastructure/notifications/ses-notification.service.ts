import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  INotificationService,
  OrcamentoDisponivelEmail,
} from '@domain/services/notification.service';
import { assuntoOrcamento, corpoOrcamento } from './email-template';

/** `INotificationService` via Amazon SES (ADR-005); credenciais da cadeia padrão do SDK (LabRole). */
export class SesNotificationService implements INotificationService {
  private readonly client: SESClient;
  private readonly from: string;

  constructor() {
    this.client = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    this.from = process.env.SES_FROM_EMAIL ?? 'no-reply@oficina.com';
  }

  async enviarOrcamentoDisponivel(
    destinatario: string,
    dados: OrcamentoDisponivelEmail,
  ): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [destinatario] },
        Message: {
          Subject: { Data: assuntoOrcamento(dados) },
          Body: { Text: { Data: corpoOrcamento(dados) } },
        },
      }),
    );
  }
}
