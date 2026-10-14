const TOKEN_KEY = 'eventease_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Without a deadline, a request that never settles leaves the caller awaiting
// forever — the checkout button reads "Processing payment…" and never recovers,
// with no error and no way to retry. Anything slower than this is a failure the
// UI can render.
const DEFAULT_TIMEOUT_MS = 20000;

const request = async (path, options = {}) => {
  const { method = 'GET', body, headers = {}, _auth = true, timeout = DEFAULT_TIMEOUT_MS } = options;
  const token = getToken();
  const config = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) config.body = JSON.stringify(body);
  if (_auth && token) config.headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  config.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(path, config);
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('The server took too long to respond. Check your connection and try again.');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = { success: false, message: 'Unexpected server response' };
  }
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401 && token) clearToken();
    throw err;
  }
  return data;
};

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== '' && v !== undefined && v !== null) sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};