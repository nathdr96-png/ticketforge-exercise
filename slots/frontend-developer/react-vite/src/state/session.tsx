import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/contract";

const TOKEN_KEY = "ticketforge.token";
const USER_KEY = "ticketforge.user";
const ORDER_IDS_KEY = "ticketforge.orderIds";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage — session simply does not persist */
  }
}

function loadUser(): User | null {
  const raw = readStorage(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function loadOrderIds(): string[] {
  const raw = readStorage(ORDER_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export interface Session {
  token: string | null;
  user: User | null;
  /** True while a login request is in flight. */
  loggingIn: boolean;
  /** Order ids this browser has created, newest first (the API has no list endpoint). */
  orderIds: string[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  rememberOrder: (orderId: string) => void;
  canSeeReports: boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => readStorage(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(() => loadUser());
  const [loggingIn, setLoggingIn] = useState(false);
  const [orderIds, setOrderIds] = useState<string[]>(() => loadOrderIds());

  useEffect(() => {
    writeStorage(TOKEN_KEY, token);
  }, [token]);

  useEffect(() => {
    writeStorage(USER_KEY, user ? JSON.stringify(user) : null);
  }, [user]);

  useEffect(() => {
    writeStorage(ORDER_IDS_KEY, JSON.stringify(orderIds));
  }, [orderIds]);

  const login = useCallback(async (email: string, password: string) => {
    setLoggingIn(true);
    try {
      const res = await api.login({ email, password });
      if (!res?.token) {
        throw new ApiError(401, "UNAUTHENTICATED", "Login did not return a token");
      }
      setToken(res.token);
      setUser(res.user);
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const rememberOrder = useCallback((orderId: string) => {
    setOrderIds((prev) => (prev.includes(orderId) ? prev : [orderId, ...prev]));
  }, []);

  const value = useMemo<Session>(
    () => ({
      token,
      user,
      loggingIn,
      orderIds,
      login,
      logout,
      rememberOrder,
      canSeeReports: user?.role === "organizer" || user?.role === "admin",
    }),
    [token, user, loggingIn, orderIds, login, logout, rememberOrder],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Narrowed accessor for views that are only rendered when authenticated. */
export function useAuthedSession(): Session & { token: string; user: User } {
  const session = useSession();
  if (!session.token || !session.user) throw new Error("Not authenticated");
  return session as Session & { token: string; user: User };
}
