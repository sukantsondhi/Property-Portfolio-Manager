import { app } from '@azure/functions';
import { json } from '../services/responses';
app.http('health', { methods: ['GET'], authLevel: 'anonymous', route: 'health', handler: async () => json(200, { status: 'ok', service: 'property-portfolio-manager-api' }) });
