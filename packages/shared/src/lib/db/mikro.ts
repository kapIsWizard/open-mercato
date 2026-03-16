import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { getSslConfig } from './ssl'

const ORM_INSTANCE_KEY = '__openMercatoOrmInstance__'
const ORM_INIT_PROMISE_KEY = '__openMercatoOrmInitPromise__'
const ORM_ENTITIES_KEY = '__openMercatoOrmEntities__'
const DEV_DB_POOL_MAX = 6
const DEV_DB_POOL_MIN = 0

type OrmGlobalState = typeof globalThis & {
  [ORM_INSTANCE_KEY]?: MikroORM<PostgreSqlDriver> | null
  [ORM_INIT_PROMISE_KEY]?: Promise<MikroORM<PostgreSqlDriver>> | null
  [ORM_ENTITIES_KEY]?: any[] | null
}

function readGlobalOrmInstance(): MikroORM<PostgreSqlDriver> | null {
  return ((globalThis as OrmGlobalState)[ORM_INSTANCE_KEY] ?? null)
}

function writeGlobalOrmInstance(instance: MikroORM<PostgreSqlDriver> | null) {
  ;(globalThis as OrmGlobalState)[ORM_INSTANCE_KEY] = instance
}

function readGlobalOrmInitPromise(): Promise<MikroORM<PostgreSqlDriver>> | null {
  return ((globalThis as OrmGlobalState)[ORM_INIT_PROMISE_KEY] ?? null)
}

function writeGlobalOrmInitPromise(promise: Promise<MikroORM<PostgreSqlDriver>> | null) {
  ;(globalThis as OrmGlobalState)[ORM_INIT_PROMISE_KEY] = promise
}

function readGlobalOrmEntities(): any[] | null {
  return ((globalThis as OrmGlobalState)[ORM_ENTITIES_KEY] ?? null)
}

function writeGlobalOrmEntities(entities: any[] | null) {
  ;(globalThis as OrmGlobalState)[ORM_ENTITIES_KEY] = entities
}

export function registerOrmEntities(entities: any[]) {
  if (readGlobalOrmEntities() !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] ORM entities re-registered (this may occur during HMR)')
  }
  writeGlobalOrmEntities(entities)
}

export function getOrmEntities(): any[] {
  const entities = readGlobalOrmEntities()
  if (!entities) {
    throw new Error('[Bootstrap] ORM entities not registered. Call registerOrmEntities() at bootstrap.')
  }
  return entities
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export function resolveDbPoolConfig(env: NodeJS.ProcessEnv) {
  const requestedPoolMin = parsePositiveInt(env.DB_POOL_MIN, 2)
  const requestedPoolMax = parsePositiveInt(env.DB_POOL_MAX, 50)
  const isProduction = env.NODE_ENV === 'production'
  const poolMax = isProduction
    ? requestedPoolMax
    : Math.min(requestedPoolMax, DEV_DB_POOL_MAX)
  const poolMin = isProduction
    ? Math.min(requestedPoolMin, poolMax)
    : Math.min(parsePositiveInt(env.DB_POOL_MIN, DEV_DB_POOL_MIN), poolMax)
  const idleTimeoutMillis = parsePositiveInt(env.DB_POOL_IDLE_TIMEOUT, 3000)
  const acquireTimeoutMillis = parsePositiveInt(env.DB_POOL_ACQUIRE_TIMEOUT, 6000)

  return {
    poolMin,
    poolMax,
    idleTimeoutMillis,
    acquireTimeoutMillis,
  }
}

export async function getOrm() {
  const cachedInstance = readGlobalOrmInstance()
  if (cachedInstance) {
    return cachedInstance
  }
  const pendingInit = readGlobalOrmInitPromise()
  if (pendingInit) {
    return pendingInit
  }
  const entities = getOrmEntities()
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')

  const {
    poolMin,
    poolMax,
    idleTimeoutMillis: poolIdleTimeout,
    acquireTimeoutMillis: poolAcquireTimeout,
  } = resolveDbPoolConfig(process.env)
  const idleSessionTimeoutEnv = parseInt(process.env.DB_IDLE_SESSION_TIMEOUT_MS || '')
  const idleInTxTimeoutEnv = parseInt(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS || '')
  const idleSessionTimeoutMs = Number.isFinite(idleSessionTimeoutEnv)
    ? idleSessionTimeoutEnv
    : process.env.NODE_ENV === 'production'
      ? undefined
      : 600_000
  const idleInTransactionTimeoutMs = Number.isFinite(idleInTxTimeoutEnv)
    ? idleInTxTimeoutEnv
    : process.env.NODE_ENV === 'production'
      ? undefined
      : 120_000
  const connectionOptions =
    idleSessionTimeoutMs && idleSessionTimeoutMs > 0
      ? `-c idle_session_timeout=${idleSessionTimeoutMs}`
      : undefined

  const sslConfig = getSslConfig()

  const nextInitPromise = MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    clientUrl,
    entities,
    debug: false,
    pool: {
      min: poolMin,
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeout,
      acquireTimeoutMillis: poolAcquireTimeout,
      destroyTimeoutMillis: process.env.NODE_ENV === 'production' ? 30000 : 3000,
    },
    driverOptions: {
      connection: {
        max: poolMax,
        min: poolMin,
        idleTimeoutMillis: poolIdleTimeout,
        acquireTimeoutMillis: poolAcquireTimeout,
        idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
        options: connectionOptions,
        ssl: sslConfig,
      },
    },
  })
  writeGlobalOrmInitPromise(nextInitPromise)
  try {
    const instance = await nextInitPromise
    writeGlobalOrmInstance(instance)
    return instance
  } finally {
    writeGlobalOrmInitPromise(null)
  }
}
