import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client';
import { expect, test } from 'vitest';

test('upgrades an existing client database without changing clients or keys', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    const folder = new URL(
      '../../server/database/migrations/',
      import.meta.url
    );
    const journal = JSON.parse(
      readFileSync(new URL('meta/_journal.json', folder), 'utf8')
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries.filter(
      (entry) => !entry.tag.startsWith('0009_')
    )) {
      const sql = readFileSync(new URL(entry.tag + '.sql', folder), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        await db.execute(statement);
    }
    await db.execute('PRAGMA foreign_keys=OFF');
    await db.execute({
      sql: `INSERT INTO clients_table (user_id, interface_id, name, ipv4_address, ipv6_address, private_key, public_key, pre_shared_key, server_allowed_ips, persistent_keepalive, mtu, enabled) VALUES (1, 'wg0', 'Existing client', '10.8.0.2', 'fd00::2', 'private', 'public', 'shared', '[]', 25, 1420, 1)`,
      args: [],
    });
    const before = (await db.execute('SELECT * FROM clients_table')).rows[0];
    const migration = readFileSync(
      fileURLToPath(new URL('0009_client_bandwidth.sql', folder)),
      'utf8'
    );
    for (const statement of migration.split('--> statement-breakpoint'))
      await db.execute(statement);
    const after = (await db.execute('SELECT * FROM clients_table')).rows[0];
    expect(after).toEqual({
      ...before,
      upload_limit_mbps: 0,
      download_limit_mbps: 0,
    });
    await db.execute(
      'UPDATE clients_table SET upload_limit_mbps = 1.25, download_limit_mbps = 12.34'
    );
    expect(
      (
        await db.execute(
          'SELECT upload_limit_mbps, download_limit_mbps FROM clients_table'
        )
      ).rows[0]
    ).toEqual({ upload_limit_mbps: 1.25, download_limit_mbps: 12.34 });
  } finally {
    db.close();
  }
});
