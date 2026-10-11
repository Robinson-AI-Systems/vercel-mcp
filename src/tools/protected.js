// Read-only view of protected resources. Modifications happen only on owner setup.
export const protectedTools = {
  tools: [{
    name: 'vercel_list_protected_resources',
    description: 'List globally and team-protected projects that AI agents cannot modify.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }, writes: false,
    profiles: ['read_only','everyday','full']
  }],
  handlers: {
    async vercel_list_protected_resources(_args,{connection,db}) {
      const rows = await db.listProtectedResources(connection.account);
      return { content: [{type:'text',text:JSON.stringify({
        account:connection.account,resources:rows.map(x=>({
          kind:x.kind,match:x.match,note:x.note,source:x.source
        }))
      })}] };
    }
  }
};
