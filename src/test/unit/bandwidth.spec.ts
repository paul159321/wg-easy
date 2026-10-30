import { describe, expect, test, vi } from 'vitest';

import { Bandwidth, type BandwidthClient } from '#server/utils/bandwidth';
import {
  bandwidthLimit,
  ClientBandwidthUpdateSchema,
} from '#db/repositories/client/types';

function client(overrides: Partial<BandwidthClient> = {}): BandwidthClient {
  return {
    id: 1,
    enabled: true,
    ipv4Address: '10.8.0.2',
    ipv6Address: 'fd00::2',
    uploadLimitMbps: 2,
    downloadLimitMbps: 4,
    ...overrides,
  };
}

// Model the observable kernel bindings rather than matching a list of shell strings.
function kernel() {
  let clsact = false;
  let counter = 0;
  let fail = false;
  const filters = new Map<
    string,
    {
      kind: string;
      options: { handle: number; actions: { kind: string; index: number }[] };
    }
  >();
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    const value = (name: string) => args[args.indexOf(name) + 1]!;
    if (args.includes('qdisc')) {
      if (args.includes('add')) {
        clsact = true;
        return '';
      }
      return JSON.stringify(clsact ? [{ kind: 'clsact' }] : []);
    }
    const direction = args.includes('ingress') ? 'ingress' : 'egress';
    const prefix = direction + ':' + value('pref') + ':';
    if (args.includes('show'))
      return JSON.stringify(
        [...filters]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, filter]) => filter)
      );
    const key = prefix + value('handle');
    if (fail && args.includes('replace')) {
      fail = false;
      throw new Error('kernel rejected rule');
    }
    if (args.includes('delete')) filters.delete(key);
    if (args.includes('replace'))
      filters.set(key, {
        kind: 'flower',
        options: {
          handle: Number(value('handle')),
          actions: [
            {
              kind: 'police',
              index: args.includes('index')
                ? Number(value('index'))
                : ++counter,
            },
          ],
        },
      });
    return '';
  });
  return {
    run,
    filters,
    calls,
    failNext: () => {
      fail = true;
    },
    restart: () => {
      clsact = false;
      filters.clear();
    },
  };
}

describe('bandwidth validation', () => {
  test.each([0, 0.01, 1.25, 10000])('accepts %s Mbps', (value) =>
    expect(bandwidthLimit.parse(value)).toBe(value)
  );
  test.each([-1, 10000.01, 0.001, Infinity, NaN, '5', true])(
    'rejects %s',
    (value) => expect(bandwidthLimit.safeParse(value).success).toBe(false)
  );
  test.each(['', null])('treats blank values as unlimited', (value) =>
    expect(bandwidthLimit.parse(value)).toBe(0)
  );
  test('requires both limits on the dedicated endpoint', () =>
    expect(
      ClientBandwidthUpdateSchema.safeParse({ uploadLimitMbps: 1 }).success
    ).toBe(false));
});

describe('bandwidth reconciliation', () => {
  test('IPv4 and IPv6 share one police action per client and direction', async () => {
    const k = kernel();
    await new Bandwidth(k.run).sync([
      client(),
      client({ id: 2, ipv4Address: '10.8.0.3', ipv6Address: 'fd00::3' }),
    ]);
    const action = (direction: string, pref: number, id: number) =>
      k.filters.get(direction + ':' + pref + ':' + id)!.options.actions[0]!
        .index;
    for (const direction of ['ingress', 'egress']) {
      expect(action(direction, 49152, 1)).toBe(action(direction, 49153, 1));
      expect(action(direction, 49152, 1)).not.toBe(action(direction, 49152, 2));
    }
    expect(action('ingress', 49152, 1)).not.toBe(action('egress', 49152, 1));
    expect(
      k.calls.some(
        (args) => args.includes('2000kbit') && args.includes('src_ip')
      )
    ).toBe(true);
    expect(
      k.calls.some(
        (args) => args.includes('4000kbit') && args.includes('dst_ip')
      )
    ).toBe(true);
  });

  test('does not reset token buckets on unrelated saves, and restores after restart', async () => {
    const k = kernel();
    const limiter = new Bandwidth(k.run);
    await limiter.sync([client()]);
    k.calls.length = 0;
    await limiter.sync([client()]);
    expect(k.calls.some((args) => args.includes('replace'))).toBe(false);
    k.restart();
    await limiter.sync([client()]);
    expect(k.filters.size).toBe(4);
  });

  test.each(['disabled', 'deleted', 'unlimited'])(
    'cleans up %s clients without deleting qdiscs',
    async (mode) => {
      const k = kernel();
      const limiter = new Bandwidth(k.run);
      await limiter.sync([client()]);
      k.calls.length = 0;
      await limiter.sync(
        mode === 'deleted'
          ? []
          : [
              client(
                mode === 'disabled'
                  ? { enabled: false }
                  : { uploadLimitMbps: 0, downloadLimitMbps: 0 }
              ),
            ]
      );
      expect(k.filters.size).toBe(0);
      expect(
        k.calls.some(
          (args) => args.includes('qdisc') && args.includes('delete')
        )
      ).toBe(false);
    }
  );

  test('updates addresses and rates, preserving direction and shared buckets', async () => {
    const k = kernel();
    const limiter = new Bandwidth(k.run);
    await limiter.sync([client()]);
    k.calls.length = 0;
    await limiter.sync([
      client({
        ipv4Address: '10.8.0.9',
        ipv6Address: 'fd00::9',
        uploadLimitMbps: 12.5,
      }),
    ]);
    expect(
      k.calls.some(
        (args) => args.includes('10.8.0.9/32') && args.includes('12500kbit')
      )
    ).toBe(true);
    expect(
      k.calls.some(
        (args) => args.includes('fd00::9/128') && args.includes('index')
      )
    ).toBe(true);
  });

  test('removes IPv6 filters when IPv6 is disabled', async () => {
    const k = kernel();
    const limiter = new Bandwidth(k.run);
    await limiter.sync([client()]);
    await limiter.sync([client()], 'wg0', false);
    expect(k.filters.size).toBe(2);
    expect([...k.filters.keys()].every((key) => key.includes(':49152:'))).toBe(
      true
    );
  });

  test('invalidates cached state after failure so rollback reapplies the old limits', async () => {
    const k = kernel();
    const limiter = new Bandwidth(k.run);
    await limiter.sync([client()]);
    k.failNext();
    await expect(
      limiter.sync([client({ uploadLimitMbps: 10 })])
    ).rejects.toThrow();
    k.calls.length = 0;
    await limiter.sync([client()]);
    expect(k.calls.some((args) => args.includes('2000kbit'))).toBe(true);
  });

  test('leaves an unlimited interface untouched', async () => {
    const k = kernel();
    await new Bandwidth(k.run).sync([
      client({ uploadLimitMbps: 0, downloadLimitMbps: 0 }),
    ]);
    expect(k.calls).toHaveLength(1);
  });

  test('refuses to overwrite a conflicting classifier', async () => {
    const run = vi.fn(async (args: string[]) =>
      args.includes('qdisc') ? '[{"kind":"clsact"}]' : '[{"kind":"u32"}]'
    );
    await expect(new Bandwidth(run).sync([client()])).rejects.toThrow(
      'reserved'
    );
    expect(run.mock.calls.every(([args]) => args.includes('show'))).toBe(true);
  });

  test('reports malformed tc output rather than treating it as an empty ruleset', async () => {
    await expect(
      new Bandwidth(async () => 'invalid').sync([client()])
    ).rejects.toThrow();
  });

  test('does not hide an interface error when clearing limits', async () => {
    await expect(
      new Bandwidth(async () => {
        throw new Error('no device');
      }).sync([])
    ).rejects.toThrow('no device');
  });
});
