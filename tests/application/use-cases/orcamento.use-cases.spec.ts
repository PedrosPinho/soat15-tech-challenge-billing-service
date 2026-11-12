import { OrcamentoUseCases, Actor } from '@application/use-cases/orcamento.use-cases';
import { Orcamento, OrcamentoStatus as O } from '@domain/entities/orcamento.entity';
import { Pagamento } from '@domain/entities/pagamento.entity';
import { requestContext } from '@shared/logger';
import { ForbiddenError, InvalidTransitionError, NotFoundError } from '@shared/errors/domain.error';
import { makeFakes } from '../../support/fakes';

const AGORA = new Date('2026-11-12T10:00:00Z');
const interno: Actor = { scope: 'interno' };
const dono: Actor = { scope: 'cliente', clienteId: 'c1' };
const outro: Actor = { scope: 'cliente', clienteId: 'c2' };

describe('OrcamentoUseCases', () => {
  let f: ReturnType<typeof makeFakes>;
  let uc: OrcamentoUseCases;
  let id: string;

  const criar = async (validadeAte = '2026-11-20T00:00:00Z'): Promise<string> => {
    const o = Orcamento.criar(
      {
        ordemServicoId: 'os-1',
        numeroOS: 'OS-1',
        sagaId: 'sg',
        cliente: { id: 'c1', nome: 'M', cpfCnpj: '1' },
        itens: [
          { tipo: 'SERVICO', referenciaId: 's', descricao: 'd', quantidade: 1, valorUnitario: 100 },
        ],
        valorTotal: 100,
        validadeAte,
      },
      AGORA,
    );
    await f.orcamentos.insert(o);
    return o.id;
  };

  beforeEach(async () => {
    f = makeFakes();
    uc = new OrcamentoUseCases({ ...f, clock: () => AGORA });
    id = await criar();
  });

  it('obter: dono e interno veem; outro cliente → 403; inexistente → 404', async () => {
    expect((await uc.obter(id, dono)).orcamento.id).toBe(id);
    expect((await uc.obter(id, interno)).pagamento).toBeNull();
    await expect(uc.obter(id, outro)).rejects.toThrow(ForbiddenError);
    await expect(uc.obter('x', interno)).rejects.toThrow(NotFoundError);
  });

  it('obter inclui o pagamento mais recente (initPoint)', async () => {
    const pg = Pagamento.criar(
      {
        orcamentoId: id,
        ordemServicoId: 'os-1',
        sagaId: 'sg',
        valor: 100,
        mpPreferenceId: 'p',
        initPoint: 'http://mp',
        expiraEm: AGORA,
      },
      AGORA,
    );
    await f.pagamentos.insert(pg);
    expect((await uc.obter(id, dono)).pagamento?.initPoint).toBe('http://mp');
    expect((await uc.obterPorOrdemServico('os-1', dono)).orcamento.id).toBe(id);
    await expect(uc.obterPorOrdemServico('os-x', dono)).rejects.toThrow(NotFoundError);
  });

  it('listarPagamentos respeita o dono; OS sem orçamento → lista vazia', async () => {
    expect(await uc.listarPagamentos('sem-orc', interno)).toEqual([]);
    expect(await uc.listarPagamentos('os-1', dono)).toEqual([]);
    await expect(uc.listarPagamentos('os-1', outro)).rejects.toThrow(ForbiddenError);
  });

  describe('aprovar', () => {
    it('aprova, publica OrcamentoAprovado com a saga e o correlationId da requisição', async () => {
      const o = await requestContext.run({ correlationId: 'corr-http' }, () =>
        uc.aprovar(id, dono),
      );
      expect(o.status).toBe(O.APROVADO);
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoAprovado',
        sagaId: 'sg',
        correlationId: 'corr-http',
        payload: { ordemServicoId: 'os-1', orcamentoId: id, aprovadoEm: AGORA.toISOString() },
      });
    });

    it('é idempotente se já aprovado (sem novo evento)', async () => {
      await uc.aprovar(id, dono);
      await uc.aprovar(id, dono);
      expect(f.db.outbox).toHaveLength(1);
    });

    it('expirado: marca EXPIRADO, publica OrcamentoRecusado e responde erro', async () => {
      const f2 = makeFakes();
      f = f2;
      uc = new OrcamentoUseCases({ ...f, clock: () => AGORA });
      const velho = await criar('2026-11-01T00:00:00Z');
      await expect(uc.aprovar(velho, dono)).rejects.toThrow(InvalidTransitionError);
      expect((await f.orcamentos.findById(velho))!.status).toBe(O.EXPIRADO);
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoRecusado',
        payload: { motivo: 'Orçamento expirado' },
      });
    });

    it('recusado/cancelado não aprova; outro cliente → 403', async () => {
      await uc.recusar(id, dono);
      await expect(uc.aprovar(id, dono)).rejects.toThrow(InvalidTransitionError);
      await expect(uc.aprovar(id, outro)).rejects.toThrow(ForbiddenError);
      await expect(uc.aprovar('x', dono)).rejects.toThrow(NotFoundError);
    });
  });

  describe('recusar', () => {
    it('recusa com motivo e publica OrcamentoRecusado; é idempotente', async () => {
      await uc.recusar(id, interno, 'caro');
      await uc.recusar(id, interno, 'caro');
      expect(f.db.outbox).toHaveLength(1);
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoRecusado',
        payload: { motivo: 'caro' },
      });
      expect((await f.orcamentos.findById(id))!.motivo).toBe('caro');
    });

    it('já aprovado não pode ser recusado', async () => {
      await uc.aprovar(id, dono);
      await expect(uc.recusar(id, dono)).rejects.toThrow(InvalidTransitionError);
    });

    it('correlationId novo quando fora de uma requisição', async () => {
      await uc.recusar(id, interno);
      expect(f.db.ultimo().correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
