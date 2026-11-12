import { readFileSync, writeFileSync } from 'node:fs';
import { Envelope } from '@shared/messaging/envelope';

/**
 * Contratos entre serviços verificados por exemplos concretos ("consumer-driven"): cada
 * serviço produz envelopes reais, normaliza o que é aleatório (ids, datas de emissão) e
 * compara com um JSON versionado; o JSON do produtor é copiado para o repo do consumidor,
 * que o alimenta aos seus handlers. Se um lado muda o formato, o teste do produtor falha
 * até o JSON ser regenerado (`UPDATE_CONTRACTS=1 npm test -- contracts`) e copiado.
 */
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizar = (envelopes: Envelope[]): unknown[] => {
  const vistos = new Map<string, string>();
  const troca = (valor: unknown): unknown => {
    if (typeof valor === 'string' && UUID.test(valor)) {
      if (!vistos.has(valor)) vistos.set(valor, `<uuid-${vistos.size + 1}>`);
      return vistos.get(valor);
    }
    if (Array.isArray(valor)) return valor.map(troca);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, troca(v)]));
    }
    return valor;
  };
  return envelopes.map((e) => ({
    ...(troca({ ...e, messageId: ZERO_UUID, sagaId: ZERO_UUID }) as object),
    occurredAt: '2026-01-01T00:00:00.000Z',
  }));
};

/** Compara com o arquivo; com `UPDATE_CONTRACTS=1` reescreve o arquivo. */
export const conferirContrato = (arquivo: string, atual: unknown[]): void => {
  const caminho = `tests/contracts/${arquivo}`;
  if (process.env.UPDATE_CONTRACTS === '1') {
    writeFileSync(caminho, JSON.stringify(atual, null, 2) + '\n');
    return;
  }
  expect(atual).toEqual(JSON.parse(readFileSync(caminho, 'utf8')));
};

export const lerContrato = (arquivo: string): Envelope[] =>
  JSON.parse(readFileSync(`tests/contracts/${arquivo}`, 'utf8')) as Envelope[];

/** Primeiro envelope de cada `type`, na ordem em que apareceram. */
export const primeiroDeCada = (envelopes: Envelope[]): Envelope[] => {
  const vistos = new Set<string>();
  return envelopes.filter((e) => (vistos.has(e.type) ? false : (vistos.add(e.type), true)));
};
