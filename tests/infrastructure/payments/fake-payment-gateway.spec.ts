import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { PaymentGatewayError } from '@shared/errors/domain.error';

describe('FakePaymentGateway', () => {
  const entrada = {
    orcamentoId: 'o',
    ordemServicoId: 's',
    numeroOS: 'n',
    descricao: 'd',
    valor: 10,
    expiraEm: new Date(),
    idempotencyKey: 'k',
  };

  it('preferência e estorno são idempotentes por chave', async () => {
    const gw = new FakePaymentGateway();
    const a = await gw.criarPreferencia(entrada);
    expect(await gw.criarPreferencia(entrada)).toEqual(a);
    gw.simularPagamento('mp-1', 'approved', 'o', 10);
    const r = await gw.estornar('mp-1', 'e1');
    expect(await gw.estornar('mp-1', 'e1')).toEqual(r);
    expect((await gw.consultarPagamento('mp-1'))!.status).toBe('refunded');
    expect(await gw.buscarPorReferencia('o')).toHaveLength(1);
  });

  it('estornar pagamento inexistente falha; falha programada vale uma vez', async () => {
    const gw = new FakePaymentGateway();
    await expect(gw.estornar('x', 'k')).rejects.toThrow(PaymentGatewayError);
    gw.falharProximaChamada = new Error('boom');
    await expect(gw.consultarPagamento('x')).rejects.toThrow('boom');
    expect(await gw.consultarPagamento('x')).toBeNull();
    gw.falharProximaChamada = new Error('boom2');
    await expect(gw.buscarPorReferencia('o')).rejects.toThrow('boom2');
  });
});
