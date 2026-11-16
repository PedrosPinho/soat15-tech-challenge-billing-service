// Mock manual do módulo 'newrelic' para toda a suíte de testes (Jest usa automaticamente qualquer
// arquivo em __mocks__/<pacote>.js para módulos de node_modules) -- evita carregar o agente de
// verdade (rede, timers, processo nativo). Por padrão NÃO há trace (a transação não insere
// headers); os testes de tracing sobrescrevem `getTransaction` quando precisam.
const transaction = {
  insertDistributedTraceHeaders: jest.fn(),
  acceptDistributedTraceHeaders: jest.fn(),
};
module.exports = {
  recordCustomEvent: jest.fn(),
  noticeError: jest.fn(),
  setTransactionName: jest.fn(),
  addCustomAttribute: jest.fn(),
  addCustomAttributes: jest.fn(),
  getLinkingMetadata: jest.fn(() => ({})),
  getTransaction: jest.fn(() => transaction),
  startBackgroundTransaction: jest.fn((_name, _group, handle) => handle()),
  __transaction: transaction,
};
