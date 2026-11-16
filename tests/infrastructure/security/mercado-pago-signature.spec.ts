import { createHmac } from 'node:crypto';
import { verificarAssinaturaMercadoPago } from '@infrastructure/security/mercado-pago-signature';

const SECRET = 'segredo-do-webhook';
const assinar = (manifesto: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(manifesto).digest('hex');

describe('verificarAssinaturaMercadoPago', () => {
  it('aceita assinatura válida (manifesto id;request-id;ts)', () => {
    const v1 = assinar('id:12345;request-id:req-1;ts:1700000000;');
    expect(
      verificarAssinaturaMercadoPago({
        xSignature: `ts=1700000000,v1=${v1}`,
        xRequestId: 'req-1',
        dataId: '12345',
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('data.id alfanumérico entra em minúsculas no manifesto', () => {
    const v1 = assinar('id:abc123;request-id:r;ts:1;');
    expect(
      verificarAssinaturaMercadoPago({
        xSignature: `ts=1,v1=${v1}`,
        xRequestId: 'r',
        dataId: 'ABC123',
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('partes ausentes são omitidas do manifesto', () => {
    const v1 = assinar('ts:5;');
    expect(verificarAssinaturaMercadoPago({ xSignature: `v1=${v1}, ts=5`, secret: SECRET })).toBe(
      true,
    );
    const v2 = assinar('id:1;ts:5;');
    expect(
      verificarAssinaturaMercadoPago({ xSignature: `ts=5,v1=${v2}`, dataId: '1', secret: SECRET }),
    ).toBe(true);
  });

  it('data.id não alfanumérico vai como veio', () => {
    const v1 = assinar('id:a-b;ts:5;');
    expect(
      verificarAssinaturaMercadoPago({
        xSignature: `ts=5,v1=${v1}`,
        dataId: 'a-b',
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it.each([
    ['secret errado', { xSignature: `ts=1,v1=${assinar('id:1;request-id:r;ts:1;', 'outro')}` }],
    [
      'data.id adulterado',
      { xSignature: `ts=1,v1=${assinar('id:1;request-id:r;ts:1;')}`, dataId: '2' },
    ],
    [
      'request-id adulterado',
      { xSignature: `ts=1,v1=${assinar('id:1;request-id:r;ts:1;')}`, xRequestId: 'x' },
    ],
    ['ts adulterado', { xSignature: `ts=2,v1=${assinar('id:1;request-id:r;ts:1;')}` }],
    ['hash de tamanho diferente', { xSignature: 'ts=1,v1=abc' }],
    ['sem v1', { xSignature: 'ts=1' }],
    ['sem ts', { xSignature: 'v1=abc' }],
    ['sem cabeçalho', { xSignature: undefined }],
  ])('rejeita %s', (_n, over) => {
    expect(
      verificarAssinaturaMercadoPago({ xRequestId: 'r', dataId: '1', secret: SECRET, ...over }),
    ).toBe(false);
  });

  it('sem secret configurado nunca valida', () => {
    const v1 = assinar('id:1;ts:1;', '');
    expect(
      verificarAssinaturaMercadoPago({ xSignature: `ts=1,v1=${v1}`, dataId: '1', secret: '' }),
    ).toBe(false);
  });
});
