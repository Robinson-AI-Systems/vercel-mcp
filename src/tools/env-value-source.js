// ENV-PLAIN: one shared, explained value-source check for vercel_env_set and
// vercel_env_set_many. Two sources exist and nothing else:
//   kind "Config" + value  — plain, non-secret configuration typed into the call
//                            (a public web address, a feature flag, a region);
//   kind "Secret" + generate — 32 random bytes made on the server, never shown.
// A secret the owner chooses is never typed into a tool call: it is set in the
// Vercel dashboard. Every refusal names the reason and the remedy in plain words.
// The value itself is never echoed: previews, results and the change log stay
// value-free (AGENTS.md "No secret ever returned").
import {RefusalError} from '../core/write.js';
import {credentialLike} from '../core/util.js';

export const MAX_CONFIG_VALUE=65536;
// Each reason stays under 240 characters: the write core shows a refusal
// reason only up to 300 characters (refusalReason), and the batch tool
// prefixes the variable name.
const SECRET_REMEDY='Use kind "Secret" with generate, or set it in the '+
  'Vercel dashboard.';
export const VALUE_REFUSALS={
  oneSource:'Give exactly one value source: value (kind "Config", non-secret '+
    'text) or generate (kind "Secret").',
  secretTyped:'kind defaults to "Secret", and a Secret is never typed into a '+
    'tool call. For plain non-secret configuration (a public web address, a '+
    'flag) pass kind "Config" with value. For a secret use generate or the '+
    'Vercel dashboard.',
  configGenerate:'A generated value is always a Secret: pass kind "Secret" '+
    'with generate, or kind "Config" with a plain value.',
  secretDevelopment:'A Secret (sensitive) variable cannot target development '+
    '(Vercel does not allow it); drop development or use a Config value.',
  generateShape:'generate must be {bytes:32, encoding:"hex"} or {bytes:32, '+
    'encoding:"base64url"}.',
  length:'A Config value must be 1 to '+MAX_CONFIG_VALUE+' characters.',
  control:'A Config value must not contain control characters (tabs and '+
    'line breaks are allowed).',
  credential:'This value looks like a credential (token prefix, key block, '+
    'long random text, password in a web address or secret in its query), '+
    'so it is not accepted as plain Config. '+SECRET_REMEDY,
  secretName:'This name looks secret (SECRET, TOKEN, PASSWORD, PRIVATE, KEY '+
    'and similar), so a typed value is refused; _URL, _ORIGIN, _HOST, _ID and '+
    'NEXT_PUBLIC_ names go by value. '+SECRET_REMEDY
};

// Names are split on "_" so MONKEY or KEYBOARD do not match KEY.
const SECRET_WORD=/^(?:SECRETS?|TOKENS?|PASSWORDS?|PASSWD|PASSPHRASES?|PRIVATE|KEYS?|APIKEYS?|CREDENTIALS?|CREDS)$/i;
const NAME_BY_VALUE=/_(?:URL|URLS|ORIGIN|ORIGINS|HOST|HOSTNAME|ID)$/i;
// Prefixes whose values every framework ships to the browser: never secret.
const BROWSER_PUBLIC=/^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_|REACT_APP_|GATSBY_)/i;
export function secretLookingName(key){
  if(typeof key!=='string'||NAME_BY_VALUE.test(key)||BROWSER_PUBLIC.test(key))
    return false;
  return key.split('_').some(word=>SECRET_WORD.test(word));
}

const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Any scheme with user:password@ (credentialLike only knows postgres URLs).
const URL_USERINFO=/[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]*:[^\s/?#@]*@/i;
const QUERY_WORD=/^(?:token|key|apikey|secret|signature|sig|password|passwd|pass|pwd|auth|credential|credentials|code)$/i;
function queryHoldsSecret(value){
  for(const match of value.matchAll(/[?&#;]([^=&#;\s?]{1,128})=/g)){
    const words=match[1].toLowerCase().split(/[-_.]/);
    if(words.some(word=>QUERY_WORD.test(word))||
      /^(?:access|refresh|id|session)token$/i.test(match[1]))return true;
  }
  return false;
}
export function credentialShapedConfig(value){
  return credentialLike(value)||URL_USERINFO.test(value)||queryHoldsSecret(value);
}

// item: {key, kind, value, generate, targets}. Throws an explained RefusalError.
export function checkValueSource(item){
  const kind=item.kind??'Secret';
  const sources=['value','generate'].filter(k=>item[k]!==undefined);
  if(sources.length!==1)throw new RefusalError(VALUE_REFUSALS.oneSource);
  if(sources[0]==='value'){
    if(kind!=='Config')throw new RefusalError(VALUE_REFUSALS.secretTyped);
    const v=item.value;
    if(typeof v!=='string'||v.length<1||v.length>MAX_CONFIG_VALUE)
      throw new RefusalError(VALUE_REFUSALS.length);
    if(CONTROL.test(v))throw new RefusalError(VALUE_REFUSALS.control);
    if(credentialShapedConfig(v))throw new RefusalError(VALUE_REFUSALS.credential);
    if(secretLookingName(item.key))throw new RefusalError(VALUE_REFUSALS.secretName);
    return {kind,source:'value',bytes:Buffer.byteLength(v)};
  }
  if(kind!=='Secret')throw new RefusalError(VALUE_REFUSALS.configGenerate);
  const g=item.generate;
  if(g===null||typeof g!=='object'||Array.isArray(g)||
    !Object.keys(g).every(k=>k==='bytes'||k==='encoding')||
    g.bytes!==32||!['hex','base64url'].includes(g.encoding))
    throw new RefusalError(VALUE_REFUSALS.generateShape);
  if(Array.isArray(item.targets)&&item.targets.includes('development'))
    throw new RefusalError(VALUE_REFUSALS.secretDevelopment);
  return {kind,source:'generate',bytes:64};
}
