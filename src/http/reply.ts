export interface Reply {
  status: number;
  contentType: string;
  body: string | Buffer;
  headers?: Record<string, string | string[]>;
}

export function json<T>(status: number, body: T): Reply {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) };
}

export function text(status: number, contentType: string, body: string | Buffer): Reply {
  return { status, contentType, body };
}

export function redirect(location: string, headers: Record<string, string | string[]> = {}): Reply {
  return { status: 302, contentType: "text/plain; charset=utf-8", body: "", headers: { location, ...headers } };
}
