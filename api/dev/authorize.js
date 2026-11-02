import { handleOAuth } from '../../src/oauth/routes.js';
// SR-4: the developer-only backend route's consent (the
// operator passphrase form). Not linked from any public
// page; see docs/DEVELOPER-ACCESS.md.
export default (req, res) => handleOAuth('devAuthorize', req, res);
