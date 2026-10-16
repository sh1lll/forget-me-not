// Online memory services, connected with your own API key. Each follows its published REST API:
//   Mem0   — https://docs.mem0.ai/api-reference  (list: POST /v3/memories/, edit: PUT /v1/memories/{id}/ {text},
//            delete: DELETE /v1/memories/{id}/, auth "Authorization: Token <key>")
//   Letta  — https://docs.letta.com/api/resources/blocks  (list: GET /v1/blocks/, edit: PATCH /v1/blocks/{id} {value},
//            delete: DELETE /v1/blocks/{id}, auth "Authorization: Bearer <key>"; self-hosted servers work too)
// Deleting here deletes on the service. A copy of the text is kept in Deleted so you can read or re-add it.

export const SERVICES = {
  mem0: {
    name: 'Mem0', color: '#7c3aed', defaultUrl: 'https://api.mem0.ai',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'userId', label: 'Only this user (optional)' }, { key: 'url', label: 'Server (only if self-hosted)' }],
    async list(c) {
      const out = [];
      for (let page = 1; page <= 20; page++) {
        // Every user's memories unless you named one ("*" is Mem0's wildcard filter).
        const r = await call(c, 'POST', `/v3/memories/?page=${page}&page_size=200`, { filters: { user_id: c.userId?.trim() || '*' } });
        for (const m of r.results ?? []) out.push({ rid: m.id, title: firstLine(m.memory), text: String(m.memory ?? ''), mtime: Date.parse(m.updated_at || m.created_at) || 0 });
        if (!r.next) break;
      }
      return out;
    },
    save: (c, rid, text) => call(c, 'PUT', `/v1/memories/${encodeURIComponent(rid)}/`, { text }),
    remove: (c, rid) => call(c, 'DELETE', `/v1/memories/${encodeURIComponent(rid)}/`),
    auth: (c) => `Token ${c.apiKey}`,
  },
  letta: {
    name: 'Letta', color: '#ff5533', defaultUrl: 'https://api.letta.com',
    fields: [{ key: 'apiKey', label: 'API key (blank for a local server)', secret: true }, { key: 'url', label: 'Server (e.g. http://localhost:8283 if self-hosted)' }],
    async list(c) {
      const blocks = await call(c, 'GET', '/v1/blocks/?limit=500');
      return (Array.isArray(blocks) ? blocks : blocks.items ?? []).map((b) => ({ rid: b.id, title: b.label || firstLine(b.value), text: String(b.value ?? ''), mtime: Date.parse(b.updated_at || b.created_at) || 0 }));
    },
    save: (c, rid, text) => call(c, 'PATCH', `/v1/blocks/${encodeURIComponent(rid)}`, { value: text }),
    remove: (c, rid) => call(c, 'DELETE', `/v1/blocks/${encodeURIComponent(rid)}`),
    auth: (c) => (c.apiKey ? `Bearer ${c.apiKey}` : null),
  },
};

const firstLine = (t) => String(t ?? '').split('\n').find((l) => l.trim())?.slice(0, 90) ?? '';

async function call(c, method, route, body) {
  const svc = SERVICES[c.service];
  const base = (c.url?.trim() || svc.defaultUrl).replace(/\/+$/, '');
  const auth = svc.auth(c);
  const r = await fetch(base + route, {
    method,
    headers: { accept: 'application/json', ...(auth ? { authorization: auth } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`${svc.name} didn't accept the API key.`);
  if (!r.ok) throw new Error(`${svc.name} said ${r.status}${await r.text().then((t) => (t ? `: ${t.slice(0, 160)}` : '')).catch(() => '')}`);
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}
