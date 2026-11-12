export interface OrcamentoDisponivelEmail {
  numeroOS: string;
  orcamentoId: string;
  clienteNome: string;
  valorTotal: number;
  validadeAte: Date;
  itens: { descricao: string; quantidade: number; valorUnitario: number }[];
  link: string;
}

export interface INotificationService {
  enviarOrcamentoDisponivel(destinatario: string, dados: OrcamentoDisponivelEmail): Promise<void>;
}
