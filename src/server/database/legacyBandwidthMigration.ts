import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Client } from '@libsql/client';
import { createDebug } from 'obug';

const DB_DEBUG = createDebug('Database');

const OFFICIAL_MIGRATIONS = [
  { tag: '0008_thin_patch', when: 1788760134302 },
  { tag: '0009_dusty_prodigy', when: 1790082534310 },
  { tag: '0010_client_bandwidth', when: 1793364960712 },
] as const;

/** Reconciles databases whose bandwidth columns predate migration 0010. */
export async function upgradeLegacyBandwidthDatabase(
  client: Client,
  migrationsFolder = './server/database/migrations'
) {
  const migrationTable = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
  );
  if (migrationTable.rows.length === 0) return;

  const recorded = await client.execute(
    'SELECT created_at FROM __drizzle_migrations'
  );
  const applied = new Set(recorded.rows.map((row) => Number(row.created_at)));
  if (applied.has(OFFICIAL_MIGRATIONS[2].when)) return;

  const columns = new Map<string, Set<string>>();
  for (const table of ['clients_table', 'interfaces_table']) {
    const result = await client.execute(`PRAGMA table_info(\`${table}\`)`);
    columns.set(table, new Set(result.rows.map((row) => String(row.name))));
  }
  const clientColumns = columns.get('clients_table')!;
  const hasUpload = clientColumns.has('upload_limit_mbps');
  const hasDownload = clientColumns.has('download_limit_mbps');
  if (!hasUpload && !hasDownload) return;

  const statements: string[] = [];
  const migrationSql = (tag: string) =>
    readFileSync(`${migrationsFolder}/${tag}.sql`, 'utf8');
  const addMissingColumns = (sql: string, tag: string) => {
    for (const statement of sql.split('--> statement-breakpoint')) {
      const match = statement.match(/ALTER TABLE `([^`]+)` ADD `([^`]+)`/i);
      if (!match) {
        throw new Error(`Unexpected SQL in migration ${tag}`);
      }
      const table = match[1]!;
      const column = match[2]!;
      if (!columns.get(table)?.has(column)) {
        statements.push(statement);
      }
    }
  };
  const record = (sql: string, when: number) => {
    const hash = createHash('sha256').update(sql).digest('hex');
    statements.push(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hash}', ${when})`
    );
  };

  const officialEight = OFFICIAL_MIGRATIONS[0];
  const eightSql = migrationSql(officialEight.tag);
  addMissingColumns(eightSql, officialEight.tag);
  if (!applied.has(officialEight.when)) {
    record(eightSql, officialEight.when);
  }

  const officialNine = OFFICIAL_MIGRATIONS[1];
  const nineSql = migrationSql(officialNine.tag);
  if (!applied.has(officialNine.when)) {
    statements.push(...nineSql.split('--> statement-breakpoint'));
    record(nineSql, officialNine.when);
  }

  const officialTen = OFFICIAL_MIGRATIONS[2];
  const tenSql = migrationSql(officialTen.tag);
  addMissingColumns(tenSql, officialTen.tag);
  record(tenSql, officialTen.when);
  await client.batch(statements, 'write');
  DB_DEBUG('Reconciled existing bandwidth columns with migrations 0008-0010');
}
