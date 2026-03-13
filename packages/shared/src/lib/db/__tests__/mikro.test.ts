import { resolveDbPoolConfig } from '../mikro'

describe('resolveDbPoolConfig', () => {
  it('caps oversized development pools to a safe maximum', () => {
    expect(resolveDbPoolConfig({
      NODE_ENV: 'development',
      DB_POOL_MIN: '5',
      DB_POOL_MAX: '120',
      DB_POOL_IDLE_TIMEOUT: '10000',
      DB_POOL_ACQUIRE_TIMEOUT: '9000',
    })).toEqual({
      poolMin: 5,
      poolMax: 20,
      idleTimeoutMillis: 10000,
      acquireTimeoutMillis: 9000,
    })
  })

  it('keeps production pool sizes unchanged', () => {
    expect(resolveDbPoolConfig({
      NODE_ENV: 'production',
      DB_POOL_MIN: '5',
      DB_POOL_MAX: '120',
    })).toEqual({
      poolMin: 5,
      poolMax: 120,
      idleTimeoutMillis: 3000,
      acquireTimeoutMillis: 6000,
    })
  })

  it('normalizes invalid values to safe defaults', () => {
    expect(resolveDbPoolConfig({
      NODE_ENV: 'development',
      DB_POOL_MIN: '-1',
      DB_POOL_MAX: 'abc',
      DB_POOL_IDLE_TIMEOUT: '0',
      DB_POOL_ACQUIRE_TIMEOUT: '',
    })).toEqual({
      poolMin: 2,
      poolMax: 20,
      idleTimeoutMillis: 3000,
      acquireTimeoutMillis: 6000,
    })
  })
})
