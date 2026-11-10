export interface KnexConfig {
  client: string;
  connection: string;
  pool: {
    min: number;
    max: number;
    acquireTimeoutMillis: number;
  };
  migrations: {
    directory: string;
    extension: string;
  };
}

export const knexConfig: KnexConfig = {
  client: 'pg',
  connection:
    process.env.DATABASE_URL ||
    'postgres://zeromttr:change-me-postgres-password@postgres:5432/payments',
  pool: {
    min: 2,
    max: 10,
    acquireTimeoutMillis: 5000
  },
  migrations: {
    directory: './migrations',
    extension: 'ts'
  }
};

export default knexConfig;
