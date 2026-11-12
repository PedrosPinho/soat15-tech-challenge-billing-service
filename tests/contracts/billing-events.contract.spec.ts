import { BillingCommandHandler } from '@application/messaging/billing-command-handler';
import { OrcamentoUseCases } from '@application/use-cases/orcamento.use-cases';
import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { PaymentGatewayError } from '@shared/errors/domain.error';
import { Envelope } from '@shared/messaging/envelope';
import { makeFakes } from '../support/fakes';
import { conferirContrato, lerContrato, normalizar, primeiroDeCada } from './normalize';

/**
 * Consumidor dos comandos do OS (`os-commands.json`, copiado do repo do OS) e PRODUTOR dos
 * eventos do Billing (`billing-events.json`, copiado para o repo do OS).
 */
describe('contrato: Billing ↔ OS', () => {
  const comandos = lerContrato('os-commands.json');
  const AGORA = new Date('2026-11-12T10:00:00Z'); // antes da validade do orçamento do fixture
  const f = makeFakes();
  const gateway = new FakePaymentGateway();
  const handler = new BillingCommandHandler({ ...f, gateway, clock: () => AGORA });
  const orcamentos = new OrcamentoUseCases({ ...f, clock: () => AGORA });
  const pagamentos = new PagamentoUseCases({ ...f, gateway, clock: () => AGORA });
  const interno = { scope: 'interno' } as const;

  const cmd = (type: string, patch: Record<string, unknown> = {}): Envelope => {
    const c = comandos.find((x) => x.type === type)!;
    return {
      ...c,
      messageId: crypto.randomUUID(),
      payload: { ...(c.payload as object), ...patch },
    };
  };
  const orcamentoDe = async (osId: string): Promise<string> =>
    (await f.orcamentos.findByOrdemServicoId(osId))!.id;

  it('o handler aceita os comandos reais do OS e os eventos batem com o contrato', async () => {
    // OS 1: orçamento -> aprovado -> pagamento -> confirmado -> estornado; depois cancelado
    await handler.handle(cmd('GerarOrcamento'));
    const orc1 = await orcamentoDe('os-1');
    await orcamentos.aprovar(orc1, interno);
    await handler.handle(cmd('SolicitarPagamento', { orcamentoId: orc1 }));
    const pg1 = (await f.pagamentos.findAtivoByOrcamentoId(orc1))!;
    gateway.simularPagamento('mp-1', 'approved', orc1, pg1.valor);
    await pagamentos.processarNotificacaoMercadoPago('mp-1');
    await handler.handle(cmd('EstornarPagamento', { pagamentoId: pg1.id }));
    await handler.handle(cmd('CancelarOrcamento', { orcamentoId: orc1 }));

    // OS 2: orçamento recusado pelo cliente
    await handler.handle(cmd('GerarOrcamento', { ordemServicoId: 'os-2' }));
    await orcamentos.recusar(await orcamentoDe('os-2'), interno, 'caro');

    // OS 3: pagamento recusado; OS 4: estorno falha no gateway; OS 5: orçamento inválido
    await handler.handle(cmd('GerarOrcamento', { ordemServicoId: 'os-3' }));
    const orc3 = await orcamentoDe('os-3');
    await orcamentos.aprovar(orc3, interno);
    await handler.handle(cmd('SolicitarPagamento', { ordemServicoId: 'os-3', orcamentoId: orc3 }));
    gateway.simularPagamento('mp-3', 'rejected', orc3, 610);
    await pagamentos.processarNotificacaoMercadoPago('mp-3');

    await handler.handle(cmd('GerarOrcamento', { ordemServicoId: 'os-4' }));
    const orc4 = await orcamentoDe('os-4');
    await orcamentos.aprovar(orc4, interno);
    await handler.handle(cmd('SolicitarPagamento', { ordemServicoId: 'os-4', orcamentoId: orc4 }));
    const pg4 = (await f.pagamentos.findAtivoByOrcamentoId(orc4))!;
    gateway.simularPagamento('mp-4', 'approved', orc4, pg4.valor);
    await pagamentos.processarNotificacaoMercadoPago('mp-4');
    gateway.falharProximaChamada = new PaymentGatewayError('MP fora do ar');
    await handler.handle(cmd('EstornarPagamento', { ordemServicoId: 'os-4', pagamentoId: pg4.id }));

    await handler.handle(cmd('GerarOrcamento', { ordemServicoId: 'os-5', valorTotal: 1 }));

    const emitidos = f.db.outbox;
    const porTipo = primeiroDeCada(emitidos);
    expect(porTipo.map((e) => e.type).sort()).toEqual([
      'EstornoFalhou',
      'OrcamentoAprovado',
      'OrcamentoCancelado',
      'OrcamentoFalhou',
      'OrcamentoGerado',
      'OrcamentoRecusado',
      'PagamentoConfirmado',
      'PagamentoEstornado',
      'PagamentoRecusado',
      'PagamentoSolicitado',
    ]);
    conferirContrato('billing-events.json', normalizar(porTipo));
  });

  it('cada comando do OS para o Billing é reconhecido', async () => {
    for (const type of [
      'GerarOrcamento',
      'CancelarOrcamento',
      'SolicitarPagamento',
      'EstornarPagamento',
    ]) {
      await expect(
        handler.handle(cmd(type, { ordemServicoId: `x-${type}` })),
      ).resolves.toBeUndefined();
    }
  });
});
