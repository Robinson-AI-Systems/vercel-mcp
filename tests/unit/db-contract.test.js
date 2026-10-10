import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runDbContract } from '../../test/contract/db-contract.js';

// The same contract runs against throwaway Postgres in tests/db/contract.test.js.
runDbContract('in-memory fake', async () => createFakeDb());
