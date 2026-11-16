import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PeriodicTask } from '@application/messaging/periodic-task';
import { logger } from '@shared/logger';
import { registrarEvento } from '@shared/observability/tracing';

export interface FilaMonitorada {
  nome: string;
  url: string;
  tipo: 'principal' | 'dlq';
}

/** Fila principal + a DLQ de mesma convenção de nome (`<fila>-dlq`, ver terraform/messaging.tf). */
export const filaComDlq = (nome: string, url: string): FilaMonitorada[] => [
  { nome, url, tipo: 'principal' },
  { nome: `${nome}-dlq`, url: `${url}-dlq`, tipo: 'dlq' },
];

/**
 * Publica periodicamente o evento customizado `FilaProfundidade` no New Relic. A integração
 * CloudWatch do New Relic é inviável no Learner Lab (exige IAM role própria), então cada
 * serviço mede as suas filas/DLQs com `GetQueueAttributes` — alimenta o dashboard e o alerta
 * "mensagem em DLQ".
 */
export class QueueDepthCollector {
  private readonly task: PeriodicTask;

  constructor(
    private readonly sqs: SQSClient,
    private readonly servico: string,
    private readonly filas: FilaMonitorada[],
    intervalMs = 60_000,
  ) {
    this.task = new PeriodicTask('queue-depth', intervalMs, () => this.coletar());
  }

  start(): void {
    this.task.start();
  }

  stop(): Promise<void> {
    return this.task.stop();
  }

  /** Uma passada: devolve quantas filas foram medidas. */
  async coletar(): Promise<number> {
    let medidas = 0;
    for (const fila of this.filas) {
      try {
        const { Attributes } = await this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: fila.url,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateNumberOfMessagesDelayed',
            ],
          }),
        );
        registrarEvento('FilaProfundidade', {
          servico: this.servico,
          fila: fila.nome,
          tipo: fila.tipo,
          mensagens: Number(Attributes?.ApproximateNumberOfMessages ?? 0),
          emVoo: Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
          atrasadas: Number(Attributes?.ApproximateNumberOfMessagesDelayed ?? 0),
        });
        medidas++;
      } catch (error) {
        logger.warn({ error, fila: fila.nome }, 'Não foi possível medir a profundidade da fila');
      }
    }
    return medidas;
  }
}
