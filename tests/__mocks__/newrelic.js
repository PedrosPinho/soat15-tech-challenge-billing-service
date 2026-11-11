// Mock manual do módulo 'newrelic' para toda a suíte de testes (Jest usa
// automaticamente qualquer arquivo em __mocks__/<pacote>.js para módulos de
// node_modules, sem precisar de jest.mock() em cada spec) -- evita que os
// testes carreguem o agente de verdade (rede, timers, processo nativo).
module.exports = {
  recordCustomEvent: jest.fn(),
  noticeError: jest.fn(),
  setTransactionName: jest.fn(),
  addCustomAttribute: jest.fn(),
  getLinkingMetadata: jest.fn(() => ({})),
};
