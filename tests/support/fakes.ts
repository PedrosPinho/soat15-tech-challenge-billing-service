import { Orcamento } from '@domain/entities/orcamento.entity';
import { Pagamento, PagamentoStatus } from '@domain/entities/pagamento.entity';
import { IInboxRepository } from '@domain/repositories/inbox.repository';
import { IOrcamentoRepository } from '@domain/repositories/orcamento.repository';
import {
  IOutboxRepository,
  NewOutboxEntry,
  OutboxEntry,
} from '@domain/repositories/outbox.repository';
import { IPagamentoRepository, ResumoFinanceiro } from '@domain/repositories/pagamento.repository';
import {
  INotificationService,
  OrcamentoDisponivelEmail,
} from '@domain/services/notification.service';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { Envelope } from '@shared/messaging/envelope';

/**
 * Unit of work dos fakes: serializa as transações (equivale ao `SELECT … FOR UPDATE` que o
 * Postgres usa para as linhas disputadas) e faz rollback do estado se o trabalho falhar.
 */
export class FakeUow implements IUnitOfWork {
  runs = 0;
  private fila: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: FakeDb) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    this.runs++;
    const execucao = this.fila.then(async () => {
      const snapshot = this.db.snapshot();
      try {
        return await work();
      } catch (error) {
        this.db.restore(snapshot);
        throw error;
      }
    });
    this.fila = execucao.catch(() => undefined);
    return execucao;
  }
}

export class FakeDb {
  orcamentos = new Map<string, ReturnType<Orcamento['toProps']>>();
  pagamentos = new Map<string, ReturnType<Pagamento['toProps']>>();
  inbox = new Set<string>();
  outbox: Envelope[] = [];

  snapshot(): FakeDb {
    const c = new FakeDb();
    c.orcamentos = new Map(this.orcamentos);
    c.pagamentos = new Map(this.pagamentos);
    c.inbox = new Set(this.inbox);
    c.outbox = [...this.outbox];
    return c;
  }
  restore(s: FakeDb): void {
    this.orcamentos = s.orcamentos;
    this.pagamentos = s.pagamentos;
    this.inbox = s.inbox;
    this.outbox = s.outbox;
  }
  tipos(): string[] {
    return this.outbox.map((e) => e.type);
  }
  ultimo(): Envelope {
    return this.outbox[this.outbox.length - 1];
  }
}

export class FakeOrcamentoRepo implements IOrcamentoRepository {
  constructor(private readonly db: FakeDb) {}
  async findById(id: string, _lock?: boolean): Promise<Orcamento | null> {
    const p = this.db.orcamentos.get(id);
    return p ? Orcamento.restaurar({ ...p }) : null;
  }
  async findByOrdemServicoId(osId: string, _lock?: boolean): Promise<Orcamento | null> {
    const p = [...this.db.orcamentos.values()].find((o) => o.ordemServicoId === osId);
    return p ? Orcamento.restaurar({ ...p }) : null;
  }
  async insert(o: Orcamento): Promise<void> {
    if ([...this.db.orcamentos.values()].some((x) => x.ordemServicoId === o.ordemServicoId)) {
      throw new Error('unique violation (ordem_servico_id)');
    }
    this.db.orcamentos.set(o.id, o.toProps());
  }
  async update(o: Orcamento): Promise<void> {
    this.db.orcamentos.set(o.id, o.toProps());
  }
}

export class FakePagamentoRepo implements IPagamentoRepository {
  constructor(private readonly db: FakeDb) {}
  private wrap(p?: ReturnType<Pagamento['toProps']>): Pagamento | null {
    return p ? Pagamento.restaurar({ ...p }) : null;
  }
  private todos(): ReturnType<Pagamento['toProps']>[] {
    return [...this.db.pagamentos.values()];
  }
  async findById(id: string, _lock?: boolean): Promise<Pagamento | null> {
    return this.wrap(this.db.pagamentos.get(id));
  }
  async findByMpPaymentId(mp: string): Promise<Pagamento | null> {
    return this.wrap(this.todos().find((p) => p.mpPaymentId === mp));
  }
  async findAtivoByOrcamentoId(orcamentoId: string, _lock?: boolean): Promise<Pagamento | null> {
    return this.wrap(
      this.todos().find(
        (p) =>
          p.orcamentoId === orcamentoId &&
          [PagamentoStatus.PENDENTE, PagamentoStatus.CONFIRMADO].includes(p.status),
      ),
    );
  }
  async findUltimoByOrcamentoId(orcamentoId: string, _lock?: boolean): Promise<Pagamento | null> {
    const lista = this.todos().filter((p) => p.orcamentoId === orcamentoId);
    return this.wrap(lista[lista.length - 1]);
  }
  async listarPorOrdemServico(osId: string): Promise<Pagamento[]> {
    return this.todos()
      .filter((p) => p.ordemServicoId === osId)
      .map((p) => Pagamento.restaurar({ ...p }));
  }
  async insert(p: Pagamento): Promise<void> {
    const props = p.toProps();
    const vivo = this.todos().some(
      (x) =>
        x.orcamentoId === props.orcamentoId &&
        [PagamentoStatus.PENDENTE, PagamentoStatus.CONFIRMADO].includes(x.status) &&
        [PagamentoStatus.PENDENTE, PagamentoStatus.CONFIRMADO].includes(props.status),
    );
    if (vivo) throw new Error('unique violation (pagamentos_ativo_por_orcamento_idx)');
    this.db.pagamentos.set(p.id, props);
  }
  async update(p: Pagamento): Promise<void> {
    this.db.pagamentos.set(p.id, p.toProps());
  }
  async resumo(): Promise<ResumoFinanceiro> {
    const soma = (s: PagamentoStatus): number =>
      this.todos()
        .filter((p) => p.status === s)
        .reduce((t, p) => t + p.valor, 0);
    const conta = (s: PagamentoStatus): number => this.todos().filter((p) => p.status === s).length;
    return {
      receitaTotal: soma(PagamentoStatus.CONFIRMADO),
      totalEstornado: soma(PagamentoStatus.ESTORNADO),
      pagamentosConfirmados: conta(PagamentoStatus.CONFIRMADO),
      pagamentosEstornados: conta(PagamentoStatus.ESTORNADO),
    };
  }
}

export class FakeOutboxRepo implements IOutboxRepository {
  constructor(private readonly db: FakeDb) {}
  async enqueue(entry: NewOutboxEntry): Promise<void> {
    this.db.outbox.push(entry.envelope);
  }
  async claimBatch(_limit: number): Promise<OutboxEntry[]> {
    return [];
  }
  async markPublished(_id: string): Promise<void> {}
  async markFailed(_id: string, _error: string, _retryAt: Date): Promise<void> {}
}

export class FakeInboxRepo implements IInboxRepository {
  constructor(private readonly db: FakeDb) {}
  async markProcessed(messageId: string): Promise<boolean> {
    if (this.db.inbox.has(messageId)) return false;
    this.db.inbox.add(messageId);
    return true;
  }
}

export class FakeNotifications implements INotificationService {
  enviados: { para: string; dados: OrcamentoDisponivelEmail }[] = [];
  falhar = false;
  async enviarOrcamentoDisponivel(para: string, dados: OrcamentoDisponivelEmail): Promise<void> {
    if (this.falhar) throw new Error('smtp fora');
    this.enviados.push({ para, dados });
  }
}

export const makeFakes = (): {
  db: FakeDb;
  uow: FakeUow;
  orcamentos: FakeOrcamentoRepo;
  pagamentos: FakePagamentoRepo;
  outbox: FakeOutboxRepo;
  inbox: FakeInboxRepo;
  notifications: FakeNotifications;
} => {
  const db = new FakeDb();
  return {
    db,
    uow: new FakeUow(db),
    orcamentos: new FakeOrcamentoRepo(db),
    pagamentos: new FakePagamentoRepo(db),
    outbox: new FakeOutboxRepo(db),
    inbox: new FakeInboxRepo(db),
    notifications: new FakeNotifications(),
  };
};
