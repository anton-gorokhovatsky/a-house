export function createSupabaseAuth({ apiUrl, publishableKey, loginDomain = '', fetchRequest = fetch }) {
  const url = new URL(apiUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.href !== url.origin + '/') {
    throw new Error('JURY_SUPABASE_URL must be an HTTPS project origin.');
  }
  const jwt = publishableKey.split('.');
  let legacyAnon = false;
  if (jwt.length === 3) {
    try { legacyAnon = JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')).role === 'anon'; }
    catch { /* A non-JWT key is validated below. */ }
  }
  if (!publishableKey.startsWith('sb_publishable_') && !legacyAnon) {
    throw new Error('Use a Supabase publishable or legacy anon key.');
  }
  if (loginDomain && !/^[a-z0-9.-]+$/i.test(loginDomain)) {
    throw new Error('JURY_LOGIN_DOMAIN must be a domain name.');
  }

  async function call(endpoint, { method = 'GET', token, body } = {}) {
    const headers = { apikey: publishableKey };
    if (token) headers.authorization = 'Bearer ' + token;
    if (body) headers['content-type'] = 'application/json';

    const response = await fetchRequest(new URL(endpoint, url), {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if ([400, 401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error('Supabase Auth is unavailable.');
    return response.json();
  }

  return {
    async signIn(login, password) {
      const email = !login.includes('@') && loginDomain ? login + '@' + loginDomain : login;
      if (!email.includes('@')) return null;
      const result = await call('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email, password }
      });
      if (!result) return null;
      return { token: result.access_token, seconds: result.expires_in, userId: result.user?.id };
    },
    async account(token) {
      return (await call('/auth/v1/user', { token }))?.id ?? null;
    }
  };
}
