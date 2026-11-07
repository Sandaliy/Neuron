import { Hono } from 'hono';

import { contentQualityQuerySchema } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';

export function contentQualityRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();
  routes.get('/', async (context) =>
    context.json(
      await repositoriesOf(context).contentQuality.inspect(
        readQuery(context, contentQualityQuerySchema),
      ),
    ),
  );
  return routes;
}
