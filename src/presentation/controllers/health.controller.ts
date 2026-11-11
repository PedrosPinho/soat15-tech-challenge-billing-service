import { Request, Response } from 'express';

export interface ReadinessProbe {
  /** Nome da dependência no corpo da resposta (ex.: `database`, `dynamodb`). */
  name: string;
  /** `true` quando a dependência está alcançável. Nunca deve lançar. */
  check: () => Promise<boolean>;
}

export class HealthController {
  constructor(private readonly probe?: ReadinessProbe) {}

  /** Processo vivo — nunca toca dependências. Reiniciar o pod não resolve problema de banco. */
  live(_req: Request, res: Response): void {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }

  /** Dependência alcançável — usado pela readinessProbe para tirar o pod do Service. */
  async ready(_req: Request, res: Response): Promise<void> {
    const ok = this.probe ? await this.safeCheck(this.probe) : true;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'UP' : 'DOWN',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      ...(this.probe ? { [this.probe.name]: ok ? 'CONNECTED' : 'DISCONNECTED' } : {}),
    });
  }

  private async safeCheck(probe: ReadinessProbe): Promise<boolean> {
    try {
      return await probe.check();
    } catch {
      return false;
    }
  }
}
