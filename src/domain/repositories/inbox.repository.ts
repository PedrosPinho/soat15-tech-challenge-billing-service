export interface IInboxRepository {
  /**
   * Registra o `messageId` como processado. Retorna `false` se já havia sido
   * registrado (mensagem duplicada). Deve rodar na mesma transação do efeito.
   */
  markProcessed(messageId: string, type: string): Promise<boolean>;
}
