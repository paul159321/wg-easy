import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { UpdateClientType } from '#db/repositories/client/types';
import WireGuard from '#server/utils/WireGuard';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  updateBandwidth: vi.fn(),
  getAll: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('#server/utils/Database', () => ({
  default: {
    clients: mocks,
    interfaces: { get: async () => ({ name: 'wg0' }) },
  },
}));
vi.mock('#server/utils/bandwidth', () => ({ bandwidth: { sync: mocks.sync } }));
vi.mock('#server/utils/config', () => ({
  OLD_ENV: {},
  WG_ENV: { DISABLE_IPV6: false },
}));
vi.mock('#server/utils/wgHelper', () => ({ wg: {} }));
vi.mock('#server/utils/firewall', () => ({ firewall: {} }));
vi.mock('#server/utils/qr', () => ({ encodeQRCode: vi.fn() }));

const previous = {
  id: 1,
  uploadLimitMbps: 2,
  downloadLimitMbps: 4,
  serverAllowedIps: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ ...previous });
  mocks.getAll.mockResolvedValue([previous]);
});

describe('client bandwidth updates', () => {
  test('rejects changes from a non-admin, including through the full editor', async () => {
    for (const bandwidthOnly of [true, false]) {
      await expect(
        WireGuard.updateClient(
          1,
          { uploadLimitMbps: 0, downloadLimitMbps: 0 },
          false,
          bandwidthOnly
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateBandwidth).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test('permits unchanged limits for a non-admin', async () => {
    await WireGuard.updateClient(
      1,
      { uploadLimitMbps: 2, downloadLimitMbps: 4 },
      false,
      true
    );
    expect(mocks.updateBandwidth).toHaveBeenCalledWith(1, 2, 4);
  });

  test('returns 404 for a removed client', async () => {
    mocks.get.mockResolvedValue(undefined);
    await expect(
      WireGuard.updateClient(
        1,
        { uploadLimitMbps: 2, downloadLimitMbps: 4 },
        true,
        true
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.updateBandwidth).not.toHaveBeenCalled();
  });

  test('prevents bypass by adding routed subnets to a limited client', async () => {
    await expect(
      WireGuard.updateClient(
        1,
        { serverAllowedIps: ['192.0.2.0/24'] } as UpdateClientType,
        false
      )
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('rejects limits on an existing routed client', async () => {
    mocks.get.mockResolvedValue({
      ...previous,
      serverAllowedIps: ['192.0.2.0/24'],
    });
    await expect(
      WireGuard.updateClient(
        1,
        { uploadLimitMbps: 2, downloadLimitMbps: 4 },
        true,
        true
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test('restores both persistent limits after a kernel error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sync
      .mockRejectedValueOnce(new Error('tc failure'))
      .mockResolvedValueOnce(undefined);
    await expect(
      WireGuard.updateClient(
        1,
        { uploadLimitMbps: 5, downloadLimitMbps: 10 },
        true,
        true
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: expect.stringContaining('Previous settings were restored'),
    });
    expect(mocks.updateBandwidth.mock.calls).toEqual([
      [1, 5, 10],
      [1, 2, 4],
    ]);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  test('reads previous values inside the queue so concurrent edits cannot overwrite a rollback', async () => {
    let stored = { ...previous };
    mocks.get.mockImplementation(async () => ({ ...stored }));
    mocks.updateBandwidth.mockImplementation(
      async (_id, uploadLimitMbps, downloadLimitMbps) => {
        stored = { ...stored, uploadLimitMbps, downloadLimitMbps };
      }
    );
    mocks.sync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('tc failure'))
      .mockResolvedValueOnce(undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = await Promise.allSettled([
      WireGuard.updateClient(
        1,
        { uploadLimitMbps: 5, downloadLimitMbps: 10 },
        true,
        true
      ),
      WireGuard.updateClient(
        1,
        { uploadLimitMbps: 6, downloadLimitMbps: 12 },
        true,
        true
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(stored).toMatchObject({ uploadLimitMbps: 5, downloadLimitMbps: 10 });
    log.mockRestore();
  });
});
