import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { expect, test } from 'vitest';

import { upgradeLegacyBandwidthDatabase } from '../../server/database/legacyBandwidthMigration';

test('upgrades legacy bandwidth data and keeps existing client settings', async () => {
  const client = createClient({ url: ':memory:' });
  const folder = new URL('../../server/database/migrations/', import.meta.url);
  const migrationsFolder = fileURLToPath(folder);
  try {
    const journal = JSON.parse(
      readFileSync(new URL('meta/_journal.json', folder), 'utf8')
    ) as { entries: { tag: string; when: number }[] };
    for (const entry of journal.entries.slice(0, 8)) {
      const sql = readFileSync(new URL(`${entry.tag}.sql`, folder), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        await client.execute(statement);
      }
    }
    await client.execute('PRAGMA foreign_keys=OFF');
    await client.execute(
      'ALTER TABLE clients_table ADD upload_limit_mbps real DEFAULT 0 NOT NULL'
    );
    await client.execute(
      'ALTER TABLE clients_table ADD download_limit_mbps real DEFAULT 0 NOT NULL'
    );
    await client.execute(`CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    await client.execute({
      sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      args: ['legacy-bandwidth', 1789980000000],
    });
    await client.execute({
      sql: `INSERT INTO clients_table
        (user_id, interface_id, name, ipv4_address, ipv6_address,
         private_key, public_key, pre_shared_key, server_allowed_ips,
         persistent_keepalive, mtu, enabled, upload_limit_mbps, download_limit_mbps)
        VALUES (1, 'wg0', 'Existing client', '10.8.0.2', 'fd00::2',
                'private', 'public', 'shared', '[]', 25, 1420, 1, 1.25, 12.34)`,
      args: [],
    });
    const before = (await client.execute('SELECT * FROM clients_table'))
      .rows[0];

    await upgradeLegacyBandwidthDatabase(client, migrationsFolder);
    await migrate(drizzle({ client }), { migrationsFolder });
    await upgradeLegacyBandwidthDatabase(client, migrationsFolder);

    expect(
      (await client.execute('SELECT * FROM clients_table')).rows[0]
    ).toEqual({
      ...before,
      content_padding_addition: null,
      rekey_after_time: null,
      rekey_timeout: null,
      reject_after_time: null,
      keepalive_timeout: null,
      max_handshake_attempts: null,
      disable_cookies: null,
    });
    const applied = await client.execute(
      'SELECT created_at FROM __drizzle_migrations ORDER BY created_at'
    );
    expect(applied.rows.map((row) => Number(row.created_at))).toEqual([
      1788760134302, 1789980000000, 1790082534310, 1793364960712,
    ]);
  } finally {
    client.close();
  }
});
