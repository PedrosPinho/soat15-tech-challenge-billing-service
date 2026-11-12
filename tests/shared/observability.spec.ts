import { createEnvelope } from '@shared/messaging/envelope';
import { requestContext, vincularSaga } from '@shared/logger';
import {
  adicionarAtributos,
  capturarTrace,
  emTransacaoDeConsumo,
  registrarErro,
  registrarEvento,
} from '@shared/observability/tracing';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nr = require('newrelic');

describe('observabilidade (fachada do New Relic)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('capturarTrace / envelope', () => {
    it('sem transação ou sem headers, o envelope não ganha o campo trace', () => {
      expect(capturarTrace()).toBeUndefined();
      const e = createEnvelope({ type: 'X', sagaId: 's', correlationId: 'c', payload: {} });
      expect(e).not.toHaveProperty('trace');
    });

    it('com transação ativa, os headers W3C/NR vão no envelope', () => {
      nr.__transaction.insertDistributedTraceHeaders.mockImplementationOnce(
        (h: Record<string, string>) => {
          h.traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
          h.newrelic = 'eyJ2IjpbMCwxXX0=';
        },
      );
      const e = createEnvelope({ type: 'X', sagaId: 's', correlationId: 'c', payload: {} });
      expect(e.trace).toEqual({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        newrelic: 'eyJ2IjpbMCwxXX0=',
      });
    });

    it('falha do agente nunca derruba o envio', () => {
      nr.getTransaction.mockImplementationOnce(() => {
        throw new Error('agente quebrado');
      });
      expect(capturarTrace()).toBeUndefined();
    });
  });

  describe('emTransacaoDeConsumo', () => {
    it('abre transação "Queue" e aceita os headers do produtor', async () => {
      const trace = { traceparent: '00-abc-def-01' };
      const r = await emTransacaoDeConsumo('fila/Tipo', trace, async () => 42);
      expect(r).toBe(42);
      expect(nr.startBackgroundTransaction).toHaveBeenCalledWith(
        'fila/Tipo',
        'Queue',
        expect.any(Function),
      );
      expect(nr.__transaction.acceptDistributedTraceHeaders).toHaveBeenCalledWith('Queue', trace);
    });

    it('sem trace do produtor não tenta aceitar nada', async () => {
      await emTransacaoDeConsumo('fila/Tipo', undefined, async () => undefined);
      expect(nr.__transaction.acceptDistributedTraceHeaders).not.toHaveBeenCalled();
    });

    it('trace corrompido não impede o processamento', async () => {
      nr.__transaction.acceptDistributedTraceHeaders.mockImplementationOnce(() => {
        throw new Error('header inválido');
      });
      await expect(
        emTransacaoDeConsumo('f/T', { traceparent: 'lixo' }, async () => 'ok'),
      ).resolves.toBe('ok');
    });

    it('erro do handler é reportado ao APM e relançado (a mensagem volta à fila)', async () => {
      await expect(
        emTransacaoDeConsumo('f/T', undefined, async () => {
          throw new Error('falhou');
        }),
      ).rejects.toThrow('falhou');
      expect(nr.noticeError).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
  });

  describe('atributos, eventos e erros', () => {
    it('adicionarAtributos descarta undefined', () => {
      adicionarAtributos({ sagaId: 's1', ordemServicoId: undefined });
      expect(nr.addCustomAttributes).toHaveBeenCalledWith({ sagaId: 's1' });
    });
    it('registrarEvento e registrarErro delegam ao agente (e aceitam não-Error)', () => {
      registrarEvento('Evento', { a: 1 });
      expect(nr.recordCustomEvent).toHaveBeenCalledWith('Evento', { a: 1 });
      registrarErro('texto');
      expect(nr.noticeError).toHaveBeenCalledWith(expect.objectContaining({ message: 'texto' }));
    });
    it('falhas do agente são engolidas', () => {
      nr.recordCustomEvent.mockImplementationOnce(() => {
        throw new Error('x');
      });
      nr.addCustomAttributes.mockImplementationOnce(() => {
        throw new Error('x');
      });
      nr.noticeError.mockImplementationOnce(() => {
        throw new Error('x');
      });
      expect(() => registrarEvento('E', {})).not.toThrow();
      expect(() => adicionarAtributos({ a: 1 })).not.toThrow();
      expect(() => registrarErro(new Error('y'))).not.toThrow();
    });
  });

  describe('vincularSaga', () => {
    it('grava saga/OS no contexto e como atributos da transação', () => {
      requestContext.run({ correlationId: 'c' }, () => {
        vincularSaga('saga-1', 'os-1');
        expect(requestContext.getStore()).toMatchObject({
          sagaId: 'saga-1',
          ordemServicoId: 'os-1',
        });
      });
      expect(nr.addCustomAttributes).toHaveBeenCalledWith({
        sagaId: 'saga-1',
        ordemServicoId: 'os-1',
      });
    });
    it('fora de um contexto só marca a transação', () => {
      vincularSaga('s', undefined);
      expect(nr.addCustomAttributes).toHaveBeenCalledWith({ sagaId: 's' });
    });
  });
});
