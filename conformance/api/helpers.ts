function baseUrl(): string {
  const raw = process.env.BASE_URL?.trim();
  if (!raw || raw === "/") return "http://127.0.0.1:3000";
  return raw.replace(/\/$/, "");
}

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<{ status: number; body: T; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const text = await res.text();
  let body: T = undefined as T;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as T;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export async function login(email: string, password = "password123") {
  const { status, body } = await api<{ token: string; user: { id: string; role: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) }
  );
  if (status !== 200) throw new Error(`login failed: ${status} ${JSON.stringify(body)}`);
  return body;
}

export function assertIntegerCents(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = obj[k];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new Error(`${k} must be integer cents, got ${JSON.stringify(v)}`);
    }
  }
}

export { baseUrl as BASE_URL };
