import { logger } from '@shared/logger';

/**
 * Executa `task` repetidamente, sem sobreposição, com intervalo fixo entre o
 * fim de uma execução e o início da próxima. Erros são logados, nunca derrubam o loop.
 */
export class PeriodicTask {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = true;
  private current?: Promise<void>;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly task: () => Promise<unknown>,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.current;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.current = this.run();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.task();
    } catch (error) {
      logger.error({ error, task: this.name }, 'Falha em tarefa periódica');
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
