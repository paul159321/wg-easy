import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Client } from '@libsql/client';

const LEGACY_MIGRATION_TIME = 1789980000000;
const OFFICIAL_MIGRATIONS = [
  { tag: '0008_thin_patch', when: 1788760134302 },
  { tag: '0009_dusty_prodigy', when: 1790082534310 },
  { tag: '0010_client_bandwidth', when: 1793364960712 },
] as const;

/** Reconciles databases created by the earlier v15 bandwidth image. */
export async function upgradeLegacyBandwidthDatabase(
  client: Client,
  migrationsFolder = './server/database/migrations'
) {
  const migrationTable = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
  );
  if (migrationTable.rows.length === 0) return;

  const legacy = await client.execute({
    sql: 'SELECT 1 FROM __drizzle_migrations WHERE created_at = ?',
    args: [LEGACY_MIGRATION_TIME],
  });
  if (legacy.rows.length === 0) return;

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
  if (
    !clientColumns.has('upload_limit_mbps') ||
    !clientColumns.has('download_limit_mbps')
  ) {
    throw new Error(
      'Legacy bandwidth migration is recorded, but its columns are missing'
    );
  }

  const statements: string[] = [];
  const migrationSql = (tag: string) =>
    readFileSync(`${migrationsFolder}/${tag}.sql`, 'utf8');
  const record = (sql: string, when: number) => {
    const hash = createHash('sha256').update(sql).digest('hex');
    statements.push(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hash}', ${when})`
    );
  };

  const officialEight = OFFICIAL_MIGRATIONS[0];
  const eightSql = migrationSql(officialEight.tag);
  if (!applied.has(officialEight.when)) {
    for (const statement of eightSql.split('--> statement-breakpoint')) {
      const match = statement.match(/ALTER TABLE `([^`]+)` ADD `([^`]+)`/i);
      if (!match) {
        throw new Error('Unexpected SQL in official migration 0008');
      }
      const table = match[1]!;
      const column = match[2]!;
      if (!columns.get(table)?.has(column)) {
        statements.push(statement);
      }
    }
    record(eightSql, officialEight.when);
  }

  const officialNine = OFFICIAL_MIGRATIONS[1];
  const nineSql = migrationSql(officialNine.tag);
  if (!applied.has(officialNine.when)) {
    statements.push(...nineSql.split('--> statement-breakpoint'));
    record(nineSql, officialNine.when);
  }

  const officialTen = OFFICIAL_MIGRATIONS[2];
  record(migrationSql(officialTen.tag), officialTen.when);
  await client.batch(statements, 'write');
}
