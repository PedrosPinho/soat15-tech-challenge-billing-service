import { Orcamento, OrcamentoStatus } from '@domain/entities/orcamento.entity';
import { Pagamento } from '@domain/entities/pagamento.entity';
import { IOrcamentoRepository } from '@domain/repositories/orcamento.repository';
import { IOutboxRepository } from '@domain/repositories/outbox.repository';
import { IPagamentoRepository } from '@domain/repositories/pagamento.repository';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { ForbiddenError, InvalidTransitionError, NotFoundError } from '@shared/errors/domain.error';
import { correlationIdAtual, publicarEvento } from '../eventos';

/** Quem está chamando: funcionário da oficina ou o cliente dono do orçamento. */
export type Actor = { scope: 'interno' } | { scope: 'cliente'; clienteId: string };

export interface OrcamentoDetalhado {
  orcamento: Orcamento;
  /** Pagamento mais recente (carrega o `initPoint` do checkout). */
  pagamento: Pagamento | null;
}

export interface OrcamentoUseCasesDeps {
  uow: IUnitOfWork;
  orcamentos: IOrcamentoRepository;
  pagamentos: IPagamentoRepository;
  outbox: IOutboxRepository;
  clock?: () => Date;
}

export class OrcamentoUseCases {
  private readonly clock: () => Date;

  constructor(private readonly d: OrcamentoUseCasesDeps) {
    this.clock = d.clock ?? ((): Date => new Date());
  }

  async obter(id: string, actor: Actor): Promise<OrcamentoDetalhado> {
    const orcamento = await this.d.orcamentos.findById(id);
    return this.detalhar(this.permitir(orcamento, actor));
  }

  async obterPorOrdemServico(ordemServicoId: string, actor: Actor): Promise<OrcamentoDetalhado> {
    const orcamento = await this.d.orcamentos.findByOrdemServicoId(ordemServicoId);
    return this.detalhar(this.permitir(orcamento, actor));
  }

  async listarPagamentos(ordemServicoId: string, actor: Actor): Promise<Pagamento[]> {
    const orcamento = await this.d.orcamentos.findByOrdemServicoId(ordemServicoId);
    if (!orcamento) return [];
    this.permitir(orcamento, actor);
    return this.d.pagamentos.listarPorOrdemServico(ordemServicoId);
  }

  aprovar(id: string, actor: Actor): Promise<Orcamento> {
    return this.decidir(id, actor, 'aprovar');
  }

  recusar(id: string, actor: Actor, motivo?: string): Promise<Orcamento> {
    return this.decidir(id, actor, 'recusar', motivo);
  }

  private async decidir(
    id: string,
    actor: Actor,
    decisao: 'aprovar' | 'recusar',
    motivo?: string,
  ): Promise<Orcamento> {
    // Autorização com leitura simples; a decisão em si roda sob lock.
    this.permitir(await this.d.orcamentos.findById(id), actor);

    const { orcamento, expirou } = await this.d.uow.run(async () => {
      const o = this.permitir(await this.d.orcamentos.findById(id, true), actor);
      const agora = this.clock();
      const correlationId = correlationIdAtual();

      if (decisao === 'aprovar') {
        if (o.status === OrcamentoStatus.APROVADO) return { orcamento: o, expirou: false }; // idempotente
        if (o.status === OrcamentoStatus.GERADO && o.expirado(agora)) {
          o.expirar(agora);
          await this.d.orcamentos.update(o);
          await publicarEvento(this.d.outbox, 'OrcamentoRecusado', o.sagaId, correlationId, {
            ordemServicoId: o.ordemServicoId,
            orcamentoId: o.id,
            motivo: 'Orçamento expirado',
          });
          return { orcamento: o, expirou: true };
        }
        o.aprovar(agora);
        await this.d.orcamentos.update(o);
        await publicarEvento(this.d.outbox, 'OrcamentoAprovado', o.sagaId, correlationId, {
          ordemServicoId: o.ordemServicoId,
          orcamentoId: o.id,
          aprovadoEm: agora.toISOString(),
        });
      } else {
        if (o.status === OrcamentoStatus.RECUSADO) return { orcamento: o, expirou: false }; // idempotente
        o.recusar(motivo, agora);
        await this.d.orcamentos.update(o);
        await publicarEvento(this.d.outbox, 'OrcamentoRecusado', o.sagaId, correlationId, {
          ordemServicoId: o.ordemServicoId,
          orcamentoId: o.id,
          motivo,
        });
      }
      return { orcamento: o, expirou: false };
    });

    if (expirou) throw new InvalidTransitionError('Orçamento expirado');
    return orcamento;
  }

  private permitir(orcamento: Orcamento | null, actor: Actor): Orcamento {
    if (!orcamento) throw new NotFoundError('Orçamento não encontrado');
    if (actor.scope === 'cliente' && orcamento.cliente.id !== actor.clienteId) {
      throw new ForbiddenError('Orçamento de outro cliente');
    }
    return orcamento;
  }

  private async detalhar(orcamento: Orcamento): Promise<OrcamentoDetalhado> {
    return { orcamento, pagamento: await this.d.pagamentos.findUltimoByOrcamentoId(orcamento.id) };
  }
}
