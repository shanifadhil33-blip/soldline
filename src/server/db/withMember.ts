/** A connection reserved for one transaction. Both Pool clients and PGlite fit this interface. */
export interface SqlConnection {
  /** Ordered rows preserve repeated column names in Auth.js joins. */
  queryArrays?(sql: string, params?: unknown[]): Promise<{ rows: unknown[][] }>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface TransactionDriver {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T>;
}

export async function withMember<T>(driver: TransactionDriver, memberId: string, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
  return driver.transaction(async (connection) => {
    await connection.query("SELECT set_config('app.member_id', $1, true)", [memberId]);
    return work(connection);
  });
}

/** Reserve a Neon Pool connection so transaction settings cannot cross requests. */
export function poolDriver(pool: { connect(): Promise<SqlConnection & { release(): void }> }): TransactionDriver {
  return {
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const result = await work(connection);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
