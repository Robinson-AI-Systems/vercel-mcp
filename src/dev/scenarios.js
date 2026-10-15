// V-1: deterministic, synthetic preview-only source fixtures. Never user secrets.
const site={
  'index.html':'<!doctype html><html><head><title>RTC test</title></head><body><main>RTC synthetic static preview</main></body></html>'
};
const api={
  'api/hello.js':'export default function handler(_request,response) { response.status(200).json({ok:true,source:"rtc-synthetic"}); }'
};
const next={
  'package.json':JSON.stringify({private:true,scripts:{build:'next build'},dependencies:{next:'15.5.2',react:'19.1.1','react-dom':'19.1.1'}}),
  'pages/index.js':'export default function Home(){return <main>RTC synthetic Next.js preview</main>;}'
};
const cron={
  ...api,
  'vercel.json':JSON.stringify({crons:[{path:'/api/hello',schedule:'0 0 * * *'}]})
};
export const DEV_SCENARIOS=Object.freeze({
  'static-site':Object.freeze({framework:null,files:Object.freeze(site),note:'Static preview page'}),
  'api-function':Object.freeze({framework:null,files:Object.freeze(api),note:'Synthetic API response'}),
  'nextjs-hello':Object.freeze({framework:'nextjs',files:Object.freeze(next),note:'Minimal Next.js preview'}),
  'cron-demo':Object.freeze({framework:null,files:Object.freeze(cron),
    note:'Cron route exists but scheduled triggers run only in production; preview must not trigger it'})
});
export function seedManifest(name){
  if(!Object.hasOwn(DEV_SCENARIOS,name))throw new TypeError('Select a documented synthetic seed scenario');
  const scenario=DEV_SCENARIOS[name];
  const files=Object.entries(scenario.files).map(([file,content])=>({file,content}));
  if(files.some(x=>Buffer.byteLength(x.content,'utf8')>2097152)||
     files.reduce((sum,x)=>sum+Buffer.byteLength(x.content,'utf8'),0)>2097152)
    throw new TypeError('Fixture exceeds bounded Vercel upload size');
  return {framework:scenario.framework,note:scenario.note,files};
}
