export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends DomainError {}
export class ValidationError extends DomainError {}
export class ConflictError extends DomainError {}
export class UnauthorizedError extends DomainError {}
export class ForbiddenError extends DomainError {}

/** Transição de estado inválida para o estado atual do agregado. */
export class InvalidTransitionError extends DomainError {}
/** Mensagem inválida de forma permanente (tipo/versão/payload) — vai para a DLQ. */
export class InvalidMessageError extends DomainError {}
/** Falha ao falar com o Mercado Pago. */
export class PaymentGatewayError extends DomainError {}
