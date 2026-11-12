import { Orcamento, OrcamentoStatus as O, arredondar } from '@domain/entities/orcamento.entity';
import { Pagamento, PagamentoStatus as P } from '@domain/entities/pagamento.entity';
import { InvalidTransitionError, ValidationError } from '@shared/errors/domain.error';

const AGORA = new Date('2026-11-12T10:00:00Z');
const FUTURO = '2026-11-20T00:00:00Z';
const itens = [
  {
    tipo: 'SERVICO' as const,
    referenciaId: 's1',
    descricao: 'Troca de amortecedor',
    quantidade: 1,
    valorUnitario: 250,
  },
  {
    tipo: 'PECA' as const,
    referenciaId: 'p1',
    descricao: 'Amortecedor',
    quantidade: 2,
    valorUnitario: 180.5,
  },
];
const novo = (over: object = {}): Orcamento =>
  Orcamento.criar(
    {
      ordemServicoId: 'os-1',
      numeroOS: 'OS-1',
      sagaId: 'sg',
      cliente: { id: 'c1', nome: 'Maria', email: 'm@x.com', cpfCnpj: '123' },
      itens,
      valorTotal: 611,
      validadeAte: FUTURO,
      ...over,
    },
    AGORA,
  );

describe('Orcamento', () => {
  it('criar valida e normaliza o total', () => {
    const o = novo({ valorTotal: 611.004 });
    expect(o.status).toBe(O.GERADO);
    expect(o.valorTotal).toBe(611);
    expect(o.validadeAte).toEqual(new Date(FUTURO));
    expect(o.toProps().itens).toHaveLength(2);
    expect(o.numeroOS).toBe('OS-1');
    expect(o.sagaId).toBe('sg');
    expect(o.criadoEm).toEqual(AGORA);
    expect(o.atualizadoEm).toEqual(AGORA);
    expect(o.motivo).toBeUndefined();
    expect(o.aprovadoEm).toBeUndefined();
    expect(o.cliente.nome).toBe('Maria');
  });

  it.each([
    ['sem ordemServicoId', { ordemServicoId: '' }, 'ordemServicoId'],
    ['sem numeroOS', { numeroOS: '' }, 'numeroOS'],
    ['sem sagaId', { sagaId: '' }, 'sagaId'],
    ['cliente sem nome', { cliente: { id: 'c', nome: '', cpfCnpj: '1' } }, 'Cliente inválido'],
    ['sem cliente', { cliente: undefined }, 'Cliente inválido'],
    ['sem itens', { itens: [], valorTotal: 0 }, 'ao menos um item'],
    ['itens não-lista', { itens: 'x' }, 'ao menos um item'],
    ['tipo inválido', { itens: [{ ...itens[0], tipo: 'X' }] }, 'Item 0'],
    ['sem descrição', { itens: [{ ...itens[0], descricao: '' }] }, 'Item 0'],
    ['quantidade 0', { itens: [{ ...itens[0], quantidade: 0 }] }, 'quantidade'],
    ['quantidade fracionada', { itens: [{ ...itens[0], quantidade: 1.5 }] }, 'quantidade'],
    ['valor negativo', { itens: [{ ...itens[0], valorUnitario: -1 }] }, 'valorUnitario'],
    ['valor não numérico', { itens: [{ ...itens[0], valorUnitario: '5' }] }, 'valorUnitario'],
    ['total divergente', { valorTotal: 600 }, 'não confere'],
    ['total não numérico', { valorTotal: '611' }, 'não confere'],
    ['total zero', { itens: [{ ...itens[0], valorUnitario: 0 }], valorTotal: 0 }, 'maior que zero'],
    ['validade inválida', { validadeAte: 'ontem' }, 'validadeAte'],
  ])('rejeita %s', (_nome, over, msg) => {
    expect(() => novo(over)).toThrow(ValidationError);
    expect(() => novo(over)).toThrow(msg);
  });

  it('aprovar: GERADO → APROVADO com data; expirado não aprova', () => {
    const o = novo();
    o.aprovar(AGORA);
    expect(o.status).toBe(O.APROVADO);
    expect(o.aprovadoEm).toEqual(AGORA);

    const velho = novo({ validadeAte: '2026-11-01T00:00:00Z' });
    expect(velho.expirado(AGORA)).toBe(true);
    expect(() => velho.aprovar(AGORA)).toThrow('expirado');
    expect(velho.status).toBe(O.GERADO);
  });

  it('recusar, expirar e cancelar', () => {
    const r = novo();
    r.recusar('caro', AGORA);
    expect(r.status).toBe(O.RECUSADO);
    expect(r.motivo).toBe('caro');

    const e = novo();
    e.expirar(AGORA);
    expect(e.status).toBe(O.EXPIRADO);

    const c1 = novo();
    c1.cancelar('saga', AGORA);
    expect(c1.status).toBe(O.CANCELADO);
    const c2 = novo();
    c2.aprovar(AGORA);
    c2.cancelar('saga', AGORA); // compensação após aprovado
    expect(c2.status).toBe(O.CANCELADO);
  });

  it.each([
    ['aprovar', (o: Orcamento) => o.aprovar(AGORA)],
    ['recusar', (o: Orcamento) => o.recusar('x', AGORA)],
    ['expirar', (o: Orcamento) => o.expirar(AGORA)],
    ['cancelar', (o: Orcamento) => o.cancelar('x', AGORA)],
  ])('%s em orçamento terminal é inválido', (_n, agir) => {
    const o = novo();
    o.recusar('x', AGORA);
    expect(() => agir(o)).toThrow(InvalidTransitionError);
  });

  it('restaurar preserva os dados', () => {
    const o = Orcamento.restaurar(novo().toProps());
    expect(o.valorTotal).toBe(611);
  });

  it('arredondar usa 2 casas', () => {
    expect(arredondar(1.005)).toBe(1.01);
    expect(arredondar(10.1 + 0.2)).toBe(10.3);
  });
});

describe('Pagamento', () => {
  const novoPg = (): Pagamento =>
    Pagamento.criar(
      {
        orcamentoId: 'o',
        ordemServicoId: 'os',
        sagaId: 'sg',
        valor: 100,
        mpPreferenceId: 'pref',
        initPoint: 'http://x',
        expiraEm: FUTURO as never,
      },
      AGORA,
    );

  it('nasce PENDENTE', () => {
    const p = novoPg();
    expect(p.status).toBe(P.PENDENTE);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.orcamentoId).toBe('o');
    expect(p.ordemServicoId).toBe('os');
    expect(p.sagaId).toBe('sg');
    expect(p.valor).toBe(100);
    expect(p.mpPreferenceId).toBe('pref');
    expect(p.initPoint).toBe('http://x');
    expect(p.criadoEm).toEqual(AGORA);
  });

  it('PENDENTE → CONFIRMADO → ESTORNADO', () => {
    const p = novoPg();
    p.confirmar('mp-1', AGORA);
    expect(p).toMatchObject({ status: P.CONFIRMADO, mpPaymentId: 'mp-1', confirmadoEm: AGORA });
    p.estornar('rf-1', 'cancelado', AGORA);
    expect(p).toMatchObject({ status: P.ESTORNADO, mpRefundId: 'rf-1', motivo: 'cancelado' });
    expect(p.atualizadoEm).toEqual(AGORA);
    expect(p.expiraEm).toBeDefined();
  });

  it('PENDENTE → RECUSADO; pagamento tardio confirma a partir de RECUSADO', () => {
    const p = novoPg();
    p.recusar('cartão recusado', AGORA);
    expect(p.status).toBe(P.RECUSADO);
    expect(p.motivo).toBe('cartão recusado');
    p.confirmar('mp-2', AGORA);
    expect(p.status).toBe(P.CONFIRMADO);
    expect(p.motivo).toBeUndefined();
  });

  it.each([
    [
      'confirmar a partir de ESTORNADO',
      (p: Pagamento) => {
        p.confirmar('a');
        p.estornar('r', 'm');
        p.confirmar('b');
      },
    ],
    ['estornar sem confirmar', (p: Pagamento) => p.estornar('r', 'm')],
    [
      'recusar após confirmar',
      (p: Pagamento) => {
        p.confirmar('a');
        p.recusar('x');
      },
    ],
  ])('rejeita %s', (_n, agir) => {
    expect(() => agir(novoPg())).toThrow(InvalidTransitionError);
  });

  it('restaurar/toProps', () => {
    const p = novoPg();
    expect(Pagamento.restaurar(p.toProps()).toProps()).toEqual(p.toProps());
    expect(p.mpPaymentId).toBeUndefined();
    expect(p.mpRefundId).toBeUndefined();
    expect(p.atualizadoEm).toEqual(AGORA);
  });
});
