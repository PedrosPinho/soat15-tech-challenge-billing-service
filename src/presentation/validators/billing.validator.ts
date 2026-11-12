import { ValidationError } from '@shared/errors/domain.error';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const validarMotivoOpcional = (body: unknown): string | undefined => {
  const motivo = isObject(body) ? body.motivo : undefined;
  if (motivo === undefined || motivo === null || motivo === '') return undefined;
  if (typeof motivo !== 'string' || motivo.length > 500) {
    throw new ValidationError('motivo deve ser um texto de até 500 caracteres');
  }
  return motivo;
};

export const validarDecisaoExterna = (body: unknown): { aprovado: boolean; motivo?: string } => {
  if (!isObject(body) || typeof body.aprovado !== 'boolean') {
    throw new ValidationError('aprovado (boolean) é obrigatório');
  }
  return { aprovado: body.aprovado, motivo: validarMotivoOpcional(body) };
};

export const validarOrdemServicoId = (query: Record<string, unknown>): string => {
  const id = query.ordemServicoId;
  if (typeof id !== 'string' || !id) throw new ValidationError('ordemServicoId é obrigatório');
  return id;
};
