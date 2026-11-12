import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureInput {
  /** Cabeçalho `x-signature`: `ts=<epoch>,v1=<hmac>`. */
  xSignature?: string;
  /** Cabeçalho `x-request-id`. */
  xRequestId?: string;
  /** `data.id` da query string da notificação. */
  dataId?: string;
  secret: string;
}

/**
 * Valida a assinatura das notificações do Mercado Pago: HMAC-SHA256, com o secret da
 * aplicação, do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (partes
 * ausentes são omitidas; `data.id` alfanumérico vai em minúsculas). Comparação em
 * tempo constante.
 */
export const verificarAssinaturaMercadoPago = ({
  xSignature,
  xRequestId,
  dataId,
  secret,
}: SignatureInput): boolean => {
  if (!xSignature || !secret) return false;

  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of xSignature.split(',')) {
    const [chave, valor] = parte.split('=', 2).map((s) => s.trim());
    if (chave === 'ts') ts = valor;
    if (chave === 'v1') v1 = valor;
  }
  if (!ts || !v1) return false;

  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifesto =
    (id ? `id:${id};` : '') + (xRequestId ? `request-id:${xRequestId};` : '') + `ts:${ts};`;
  const esperado = createHmac('sha256', secret).update(manifesto).digest('hex');

  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
};
