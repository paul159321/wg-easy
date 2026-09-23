import { getValidatedRouterParams, readValidatedBody } from 'h3';

import WireGuard from '#server/utils/WireGuard';
import { definePermissionEventHandler } from '#server/utils/handler';
import { validateZod } from '#server/utils/types';
import {
  ClientBandwidthUpdateSchema,
  ClientGetSchema,
} from '#db/repositories/client/types';

export default definePermissionEventHandler(
  'admin',
  'any',
  async ({ event }) => {
    const { clientId } = await getValidatedRouterParams(
      event,
      validateZod(ClientGetSchema, event)
    );
    const data = await readValidatedBody(
      event,
      validateZod(ClientBandwidthUpdateSchema, event)
    );
    await WireGuard.updateClient(clientId, data, true, true);

    return { success: true };
  }
);
