export type CaseItem = {
  id: number;
  slug: string;
  title: string;
  description: string;
  fileName: string;
  size: number;
  allowDownload: boolean;
  published: boolean;
  views: number;
  downloads: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
};

export type PublicCase = Pick<CaseItem, 'slug' | 'title' | 'description' | 'fileName' | 'size' | 'allowDownload' | 'updatedAt'>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  return data as T;
}

// Organizer calls share the ticket desk session, which is scoped to /api/tm.
export async function adminApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/tm/${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('No connection. Check the internet and try again.', 0);
  }
  return parse<T>(response);
}

// Uses XMLHttpRequest because fetch cannot report upload progress.
export function uploadForm<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/tm/${path}`);
    request.withCredentials = true;
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onerror = () => reject(new ApiError('Upload failed. Check the internet and try again.', 0));
    request.onload = () => {
      let data: { error?: string } = {};
      try { data = JSON.parse(request.responseText); } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300) resolve(data as T);
      else reject(new ApiError(data.error || `Upload failed (${request.status})`, request.status));
    };
    request.send(form);
  });
}

export async function publicCase(slug: string): Promise<PublicCase> {
  let response: Response;
  try {
    response = await fetch(`/api/cases/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  } catch {
    throw new ApiError('No connection. Check the internet and try again.', 0);
  }
  return (await parse<{ case: PublicCase }>(response)).case;
}

export function caseFileUrl(item: Pick<CaseItem, 'slug' | 'updatedAt'>, download = false) {
  return `/api/cases/${item.slug}/file?v=${item.updatedAt}${download ? '&download=1' : ''}`;
}

export function caseLink(slug: string) {
  const origin = typeof window === 'undefined' ? 'https://nsumibc.online' : window.location.origin;
  return `${origin}/case/${slug}/`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: number) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
