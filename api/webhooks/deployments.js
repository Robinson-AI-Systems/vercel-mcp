// AUD-CI: the deployment webhook receiver route. The signature
// is computed over the RAW body, so the platform body parser
// stays off for this function and src/webhooks/receiver.js
// reads the stream itself.
import { handleDeploymentWebhook } from '../../src/webhooks/receiver.js';

export const config = { api: { bodyParser: false } };

export default (req, res) => handleDeploymentWebhook(req, res);
