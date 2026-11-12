import { OrcamentoDisponivelEmail } from '@domain/services/notification.service';

const brl = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const assuntoOrcamento = (d: OrcamentoDisponivelEmail): string =>
  `Orçamento da OS ${d.numeroOS} disponível`;

export const corpoOrcamento = (d: OrcamentoDisponivelEmail): string =>
  [
    `Olá, ${d.clienteNome}!`,
    '',
    `O orçamento da sua ordem de serviço ${d.numeroOS} está disponível:`,
    ...d.itens.map((i) => `  - ${i.quantidade}x ${i.descricao}: ${brl(i.quantidade * i.valorUnitario)}`),
    '',
    `Total: ${brl(d.valorTotal)}`,
    `Válido até: ${d.validadeAte.toLocaleDateString('pt-BR')}`,
    '',
    `Para aprovar ou recusar: ${d.link}`,
  ].join('\n');
