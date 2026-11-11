const mockClient = { release: jest.fn() };
const mockPool = {
  connect: jest.fn(),
  on: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
};
jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }));

import {
  connectDatabase,
  disconnectDatabase,
  getPool,
  setPool,
} from '@infrastructure/database/postgres/pool';
import { Pool } from 'pg';

describe('postgres pool', () => {
  const original = process.env.DATABASE_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    await disconnectDatabase();
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
    mockPool.connect.mockResolvedValue(mockClient);
  });

  afterAll(() => {
    process.env.DATABASE_URL = original;
  });

  it('getPool lança antes de conectar', () => {
    expect(() => getPool()).toThrow(/não inicializado/);
  });

  it('lança sem DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URI;
    await expect(connectDatabase()).rejects.toThrow(/DATABASE_URL/);
  });

  it('conecta, libera o client de teste e reaproveita o pool', async () => {
    const pool = await connectDatabase();
    expect(mockClient.release).toHaveBeenCalled();
    expect(await connectDatabase()).toBe(pool);
    expect(getPool()).toBe(pool);
  });

  it('tenta de novo e conecta na segunda tentativa', async () => {
    mockPool.connect.mockRejectedValueOnce(new Error('down')).mockResolvedValue(mockClient);
    await expect(connectDatabase({ retries: 2, retryDelayMs: 1 })).resolves.toBeDefined();
    expect(mockPool.connect).toHaveBeenCalledTimes(2);
  });

  it('desiste após esgotar as tentativas e fecha o pool candidato', async () => {
    mockPool.connect.mockRejectedValue(new Error('down'));
    await expect(connectDatabase({ retries: 2, retryDelayMs: 1 })).rejects.toThrow('down');
    expect(mockPool.end).toHaveBeenCalled();
  });

  it('registra handler de erro do pool', async () => {
    await connectDatabase();
    expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = mockPool.on.mock.calls[0][1] as (e: Error) => void;
    expect(() => handler(new Error('x'))).not.toThrow();
  });

  it('setPool injeta e disconnectDatabase encerra', async () => {
    setPool(new Pool() as unknown as Pool);
    expect(getPool()).toBeDefined();
    await disconnectDatabase();
    expect(mockPool.end).toHaveBeenCalled();
    expect(() => getPool()).toThrow();
  });
});
