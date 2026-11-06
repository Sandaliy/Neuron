import { Hono } from 'hono';

import {
  possibleDuplicateGroupsQuerySchema,
  possibleDuplicateNotesQuerySchema,
} from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';

export function possibleDuplicateRoutes() {
  const routes = new Hono<RequestBindings>();
  routes.get('/', async (context) =>
    context.json(
      await repositoriesOf(context).possibleDuplicates.groups(
        readQuery(context, possibleDuplicateGroupsQuerySchema),
      ),
    ),
  );
  routes.get('/notes', async (context) =>
    context.json(
      await repositoriesOf(context).possibleDuplicates.notes(
        readQuery(context, possibleDuplicateNotesQuerySchema),
      ),
    ),
  );
  return routes;
}
