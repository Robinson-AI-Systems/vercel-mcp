import {handleOAuth} from '../../src/oauth/routes.js';
export default (req,res)=>handleOAuth('revoke',req,res);
