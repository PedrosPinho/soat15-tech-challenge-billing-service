const sendMail = jest.fn().mockResolvedValue({});
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport } }));
const sesSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({ send: sesSend })),
  SendEmailCommand: jest.fn((input) => ({ input })),
}));

import { NodemailerNotificationService } from '@infrastructure/notifications/nodemailer-notification.service';
import { SesNotificationService } from '@infrastructure/notifications/ses-notification.service';
import { corpoOrcamento } from '@infrastructure/notifications/email-template';
import { makeNotificationService } from '@main/factories/notification.factory';

const dados = {
  numeroOS: 'OS-1',
  orcamentoId: 'o1',
  clienteNome: 'Maria',
  valorTotal: 310,
  validadeAte: new Date('2026-11-20T12:00:00Z'),
  itens: [
    { descricao: 'Revisão', quantidade: 1, valorUnitario: 250 },
    { descricao: 'Filtro', quantidade: 2, valorUnitario: 30 },
  ],
  link: 'https://api/api/orcamentos/o1',
};

describe('e-mail de orçamento', () => {
  it('corpo traz itens, total, validade e link', () => {
    const texto = corpoOrcamento(dados);
    expect(texto).toContain('Olá, Maria!');
    expect(texto).toMatch(/2x Filtro: R\$\s?60,00/);
    expect(texto).toMatch(/Total: R\$\s?310,00/);
    expect(texto).toContain('20/11/2026');
    expect(texto).toContain(dados.link);
  });

  it('SMTP envia com remetente configurado', async () => {
    process.env.SMTP_HOST = 'smtp.local';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    process.env.SMTP_FROM = 'oficina@x.com';
    await new NodemailerNotificationService().enviarOrcamentoDisponivel('c@x.com', dados);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.local', port: 587, auth: { user: 'u', pass: 'p' } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'oficina@x.com',
        to: 'c@x.com',
        subject: 'Orçamento da OS OS-1 disponível',
      }),
    );
  });

  it('SMTP sem usuário não usa autenticação e remetente padrão', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_FROM;
    await new NodemailerNotificationService().enviarOrcamentoDisponivel('c@x.com', dados);
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ auth: undefined }));
    expect(sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: 'no-reply@oficina.com' }),
    );
  });

  it('SES envia com o remetente configurado', async () => {
    process.env.SES_FROM_EMAIL = 'ses@x.com';
    await new SesNotificationService().enviarOrcamentoDisponivel('c@x.com', dados);
    const cmd = sesSend.mock.calls[0][0];
    expect(cmd.input).toMatchObject({
      Source: 'ses@x.com',
      Destination: { ToAddresses: ['c@x.com'] },
    });
    expect(cmd.input.Message.Body.Text.Data).toContain('OS-1');
  });

  it('SES usa remetente padrão', async () => {
    delete process.env.SES_FROM_EMAIL;
    await new SesNotificationService().enviarOrcamentoDisponivel('c@x.com', dados);
    expect(sesSend.mock.calls.pop()[0].input.Source).toBe('no-reply@oficina.com');
  });

  it('factory escolhe pelo NOTIFICATION_PROVIDER', () => {
    process.env.NOTIFICATION_PROVIDER = 'ses';
    expect(makeNotificationService()).toBeInstanceOf(SesNotificationService);
    delete process.env.NOTIFICATION_PROVIDER;
    expect(makeNotificationService()).toBeInstanceOf(NodemailerNotificationService);
  });
});
