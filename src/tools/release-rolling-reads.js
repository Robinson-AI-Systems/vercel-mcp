// D-4: owner-visible configuration, billing and active traffic stage.
import {schema,respond} from './release-common.js';
import {shared,exact,rollingSnapshot} from './release-rolling-common.js';
const properties={project:shared.project};
export const rollingReadTools={
  tools:[{name:'vercel_rolling_get',area:'releases',writes:false,
    profiles:['read_only','everyday','full'],
    description:'Read the selected project rolling-release template, active stage and billing eligibility without secrets.',
    inputSchema:schema(properties,['project']),
    annotations:{readOnlyHint:true}}],
  handlers:{
    async vercel_rolling_get(args,ctx){
      exact(args,properties);
      const state=await rollingSnapshot(args,ctx,{billing:true});
      return respond({project:state.project,config:state.config,
        active:state.rollout,billing:state.billing,
        note:'Configuration affects future releases only; active routing must be confirmed independently'});
    }
  }
};
