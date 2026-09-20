import { app } from '@azure/functions';
import { authorizeOrganization } from '../services/auth';
import { calculateDashboard } from '../services/finance';
import { json, problem } from '../services/responses';
import { getStore } from '../services/store';
app.http('dashboard', { methods: ['GET'], authLevel: 'anonymous', route: 'dashboard', handler: async request => { try { const user = await authorizeOrganization(request); return json(200, await getStore(user.organizationId).allActive().then(calculateDashboard)); } catch (error) { return problem(error); } } });
