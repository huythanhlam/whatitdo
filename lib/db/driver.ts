// The single database seam. Both drivers — a `pg` Pool against Supabase's
// Supavisor pooler (prod) and an embedded PGlite instance (zero-credential dev)
// — implement this interface, so every query in `lib/db/index.ts` is written
// exactly once in SQL. `query` runs a single parameterized statement and
// returns the rows directly; `exec` runs a multi-statement DDL script (used by
// the migration runner) and is the only place raw scripts are executed.
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
}
