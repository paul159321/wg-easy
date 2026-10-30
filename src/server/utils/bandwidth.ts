import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ClientType } from '#db/repositories/client/types';

const execute = promisify(execFile);
type Direction = 'ingress' | 'egress';
type Family = 4 | 6;
export type BandwidthClient = Pick<
  ClientType,
  | 'id'
  | 'enabled'
  | 'ipv4Address'
  | 'ipv6Address'
  | 'uploadLimitMbps'
  | 'downloadLimitMbps'
>;
type Filter = {
  kind?: string;
  options?: {
    handle?: number | string;
    actions?: { kind?: string; index?: number }[];
  };
};
// Only these priorities are owned by wg-easy. Never remove the root/clsact qdisc.
const PRIORITIES = { 4: '49152', 6: '49153' } as const;

function parseList(output: string): Filter[] {
  const data: unknown = JSON.parse(output);
  if (!Array.isArray(data)) throw new Error('Unexpected tc response');
  return data as Filter[];
}

function actionIndex(filter?: Filter) {
  return filter?.options?.actions?.find((action) => action.kind === 'police')
    ?.index;
}

export class Bandwidth {
  // Remember successful configurations, but verify filters still exist after an interface restart.
  #applied = new Map<string, string>();

  constructor(
    private readonly run: (args: string[]) => Promise<string> = async (
      args
    ) => {
      const { stdout } = await execute('tc', args, {
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    }
  ) {}

  async sync(clients: BandwidthClient[], device = 'wg0', enableIpv6 = true) {
    for (const client of clients) {
      if (
        !Number.isSafeInteger(client.id) ||
        client.id <= 0 ||
        client.id > 0xffffffff
      ) {
        throw new Error('Invalid client ID for bandwidth filter');
      }
      for (const value of [client.uploadLimitMbps, client.downloadLimitMbps]) {
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          value > 10000 ||
          Math.abs(value * 100 - Math.round(value * 100)) > 1e-7
        ) {
          throw new Error('Invalid bandwidth limit');
        }
      }
    }
    const limited = clients.filter(
      (client) =>
        client.enabled &&
        (client.uploadLimitMbps > 0 || client.downloadLimitMbps > 0)
    );
    let qdiscs: Filter[];
    try {
      qdiscs = parseList(
        await this.run(['-j', 'qdisc', 'show', 'dev', device])
      );
    } catch (error) {
      if (
        !limited.length &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        this.#applied.clear();
        return;
      }
      throw error;
    }
    if (!qdiscs.some((qdisc) => qdisc.kind === 'clsact')) {
      this.#applied.clear();
      if (!limited.length) return;
      await this.run(['qdisc', 'add', 'dev', device, 'clsact']);
    }

    const next = new Map<string, string>();
    try {
      for (const direction of ['ingress', 'egress'] as const) {
        const current = new Map<Family, Filter[]>();
        for (const family of [4, 6] as const) {
          const filters = await this.filters(device, direction, family);
          if (
            filters.some((filter) => filter.kind && filter.kind !== 'flower')
          ) {
            throw new Error(
              'tc priority ' +
                PRIORITIES[family] +
                ' is reserved for wg-easy bandwidth limits'
            );
          }
          current.set(family, filters);
        }
        const desired = limited.filter(
          (client) =>
            (direction === 'ingress'
              ? client.uploadLimitMbps
              : client.downloadLimitMbps) > 0
        );
        for (const client of desired) {
          const rate =
            direction === 'ingress'
              ? client.uploadLimitMbps
              : client.downloadLimitMbps;
          const handle = String(client.id);
          const key = device + ':' + direction + ':' + handle;
          const signature = JSON.stringify([
            client.ipv4Address,
            client.ipv6Address,
            rate,
            enableIpv6,
          ]);
          const find = (family: Family) =>
            current
              .get(family)
              ?.find((filter) => Number(filter.options?.handle) === client.id);
          const index = actionIndex(find(4));
          const unchanged =
            this.#applied.get(key) === signature &&
            index !== undefined &&
            (!enableIpv6 || actionIndex(find(6)) === index);
          if (!unchanged) {
            // Let the kernel allocate the action index. The IPv6 filter binds to the
            // same token bucket, so both address families share the client's rate.
            await this.run([
              ...this.filterArgs(device, direction, 4, handle),
              'flower',
              'skip_hw',
              direction === 'ingress' ? 'src_ip' : 'dst_ip',
              client.ipv4Address + '/32',
              'action',
              'police',
              'rate',
              Math.round(rate * 1000) + 'kbit',
              'burst',
              String(Math.max(65536, Math.ceil(rate * 125000 * 0.02))),
              'mtu',
              '65535',
              'conform-exceed',
              'drop/ok',
            ]);
            if (enableIpv6) {
              const updated = await this.filters(device, direction, 4);
              const sharedIndex = actionIndex(
                updated.find(
                  (filter) => Number(filter.options?.handle) === client.id
                )
              );
              if (
                !Number.isSafeInteger(sharedIndex) ||
                !sharedIndex ||
                sharedIndex < 1
              )
                throw new Error('Could not read tc police action index');
              await this.run([
                ...this.filterArgs(device, direction, 6, handle),
                'flower',
                'skip_hw',
                direction === 'ingress' ? 'src_ip' : 'dst_ip',
                client.ipv6Address + '/128',
                'action',
                'police',
                'index',
                String(sharedIndex),
              ]);
            }
          }
          next.set(key, signature);
        }
        // Delete obsolete filters only after new filters have been installed.
        // Shared actions disappear automatically when their last binding is removed.
        for (const family of [4, 6] as const) {
          const handles = new Set(
            (family === 6 && !enableIpv6 ? [] : desired).map(
              (client) => client.id
            )
          );
          for (const filter of current.get(family) ?? []) {
            const handle = filter.options?.handle;
            if (handle !== undefined && !handles.has(Number(handle))) {
              await this.run([
                'filter',
                'delete',
                'dev',
                device,
                direction,
                'protocol',
                family === 4 ? 'ip' : 'ipv6',
                'pref',
                PRIORITIES[family],
                'handle',
                String(Number(handle)),
                'flower',
              ]);
            }
          }
        }
      }
      this.#applied = next;
    } catch (error) {
      this.#applied.clear();
      throw error;
    }
  }

  private filters(device: string, direction: Direction, family: Family) {
    return this.run([
      '-j',
      'filter',
      'show',
      'dev',
      device,
      direction,
      'pref',
      PRIORITIES[family],
    ]).then(parseList);
  }

  private filterArgs(
    device: string,
    direction: Direction,
    family: Family,
    handle: string
  ) {
    return [
      'filter',
      'replace',
      'dev',
      device,
      direction,
      'protocol',
      family === 4 ? 'ip' : 'ipv6',
      'pref',
      PRIORITIES[family],
      'handle',
      handle,
    ];
  }
}

export const bandwidth = new Bandwidth();
