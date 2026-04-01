import { createClient, Client, Row } from '@libsql/client';
import path from 'path';
import fs from 'fs';

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

function rowToObject(row: Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    obj[key] = value;
  }
  return obj;
}

class PreparedStatement implements D1PreparedStatement {
  private db: Client;
  private sql: string;
  private values: unknown[];

  constructor(db: Client, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new PreparedStatement(this.db, this.sql, values);
  }

  async run(): Promise<D1Result> {
    const result = await this.db.execute({
      sql: this.sql,
      args: this.values as any[],
    });
    return {
      results: [],
      success: true,
      meta: {
        changes: result.rowsAffected,
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const result = await this.db.execute({
      sql: this.sql,
      args: this.values as any[],
    });
    const results = result.rows.map((row) => rowToObject(row) as T);
    return {
      results,
      success: true,
    };
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = await this.db.execute({
      sql: this.sql,
      args: this.values as any[],
    });
    if (result.rows.length === 0) return null;
    return rowToObject(result.rows[0]) as T;
  }
}

export class SQLiteD1Adapter {
  private db: Client;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = createClient({
      url: `file:${dbPath}`,
    });
  }

  prepare(sql: string): D1PreparedStatement {
    return new PreparedStatement(this.db, sql);
  }

  async dump(): Promise<ArrayBuffer> {
    const result = await this.db.execute('SELECT * FROM sqlite_master');
    const lines: string[] = [];
    for (const row of result.rows) {
      lines.push(JSON.stringify(row));
    }
    return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const stmts = statements.map((stmt) => {
      const ps = stmt as PreparedStatement;
      return {
        sql: (ps as any)['sql'] as string,
        args: (ps as any)['values'] as any[],
      };
    });

    const results = await this.db.batch(stmts, 'write');
    
    return results.map((result) => ({
      results: result.rows.map((row) => rowToObject(row) as T),
      success: true,
      meta: {
        changes: result.rowsAffected,
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    }));
  }

  async exec(sql: string): Promise<D1Result> {
    await this.db.executeMultiple(sql);
    return {
      results: [],
      success: true,
    };
  }

  close(): void {
    // libsql client doesn't have explicit close
  }

  getRawDb(): Client {
    return this.db;
  }

  getDbPath(): string {
    return this.dbPath;
  }
}

export function createDatabaseAdapter(dbPath: string): SQLiteD1Adapter {
  return new SQLiteD1Adapter(dbPath);
}

export type D1Database = SQLiteD1Adapter;
