import {createHash} from 'node:crypto';
// Own service database only; no provider credentials or raw authorization code stored here.
export const HANDOFF_SCHEMA=`CREATE TABLE IF NOT EXISTS developer_oauth_handoffs (
  state text PRIMARY KEY, client_id text NOT NULL UNIQUE, challenge text NOT NULL,
  poll_hash text NOT NULL, public_key text NOT NULL, ip_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','denied')),
  sealed_code text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  last_poll_at timestamptz, delivered_at timestamptz
)`;
export const HANDOFF_LIMIT_SCHEMA=`CREATE TABLE IF NOT EXISTS developer_handoff_limits (
  ip_hash text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL
)`;
export function handoffStore(query,{google=false}={}){
  return {
    async start(p){
      // Atomic shared counter serializes starts for this trusted IP across registered clients.
      const quota=await query(`INSERT INTO developer_handoff_limits(ip_hash,window_start,hits) VALUES($1,now(),1)
        ON CONFLICT(ip_hash) DO UPDATE SET
          hits=CASE WHEN developer_handoff_limits.window_start<=now()-interval '10 minutes' THEN 1 ELSE developer_handoff_limits.hits+1 END,
          window_start=CASE WHEN developer_handoff_limits.window_start<=now()-interval '10 minutes' THEN now() ELSE developer_handoff_limits.window_start END
        WHERE developer_handoff_limits.hits<10 OR developer_handoff_limits.window_start<=now()-interval '10 minutes'
        RETURNING hits`,[p.ip]);
      if(!quota.length)return false;
      // One pending handoff per client. Database constraints arbitrate simultaneous starts.
      const rows=await query(`INSERT INTO developer_oauth_handoffs
        (state,client_id,challenge,poll_hash,public_key,ip_hash,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7

        ON CONFLICT(client_id) DO UPDATE SET state=EXCLUDED.state,challenge=EXCLUDED.challenge,
          poll_hash=EXCLUDED.poll_hash,public_key=EXCLUDED.public_key,ip_hash=EXCLUDED.ip_hash,
          expires_at=EXCLUDED.expires_at,created_at=now(),status='pending',sealed_code=NULL,last_poll_at=NULL,delivered_at=NULL
          WHERE developer_oauth_handoffs.expires_at<=now()
        RETURNING state`,[p.state,p.client_id,p.challenge,p.poll_hash,p.public_key,p.ip,p.expires]);
      return rows.length===1;
    },
    async find(state){return (await query('SELECT * FROM developer_oauth_handoffs WHERE state=$1 AND expires_at>now()',[state]))[0]||null;},
    async codeProof(code){
      const key=google?code:createHash('sha256').update(code).digest('hex');
      const text=google?`SELECT client_id,redirect_uri,code_challenge,code_challenge_method FROM oauth_codes WHERE code=$1 AND used=false AND expires_at>now()`:
        `SELECT client_id,data->>'redirect_uri' AS redirect_uri,data->>'code_challenge' AS code_challenge,data->>'code_challenge_method' AS code_challenge_method FROM oauth_codes WHERE code=$1 AND expires_at>now()`;
      return (await query(text,[key]))[0]||null;
    },
    async approve(state,sealed){return (await query(`UPDATE developer_oauth_handoffs SET status='authorized',sealed_code=$2
      WHERE state=$1 AND status='pending' AND expires_at>now() AND delivered_at IS NULL RETURNING state`,[state,sealed])).length===1;},
    async deny(state){await query(`UPDATE developer_oauth_handoffs SET status='denied' WHERE state=$1 AND status='pending' AND expires_at>now()`,[state]);},
    async poll(state,hash){
      const rows=await query(`UPDATE developer_oauth_handoffs SET last_poll_at=now(),
        delivered_at=CASE WHEN status<>'pending' THEN COALESCE(delivered_at,now()) ELSE NULL END
        WHERE state=$1 AND poll_hash=$2 AND expires_at>now()
        AND (status<>'pending' OR last_poll_at IS NULL OR last_poll_at<now()-interval '4 seconds') RETURNING status,sealed_code`,[state,hash]);
      return rows[0]||null;
    }
  };
}
