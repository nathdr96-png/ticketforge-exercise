import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { api, ApiError } from "../lib/api";
import type { User } from "../lib/contract";

/**
 * The signed-in session, plus the order ids this install has created.
 *
 * The session lives in memory only. A real shipped app would persist the token
 * through `@react-native-async-storage/async-storage` so the buyer is not
 * signed out every cold start — that is a device concern this slot deliberately
 * does not implement, and the README says so plainly rather than pretending the
 * omission is a design choice.
 *
 * Order ids are remembered the same way because the contract has no "list my
 * orders" endpoint: the app knows what it bought and re-reads each one with
 * `GET /orders/{id}`.
 */
export interface Session {
  token: string | null;
  user: User | null;
  signingIn: boolean;
  orderIds: readonly string[];
  signIn(email: string, password: string): Promise<void>;
  signOut(): void;
  rememberOrder(orderId: string): void;
  canSeeReports: boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [orderIds, setOrderIds] = useState<readonly string[]>([]);

  const signIn = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    try {
      const result = await api.login(email, password);
      if (!result?.token) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign-in returned no token");
      }
      setToken(result.token);
      setUser(result.user);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    setOrderIds([]);
  }, []);

  const rememberOrder = useCallback((orderId: string) => {
    setOrderIds((previous) =>
      previous.includes(orderId) ? previous : [orderId, ...previous],
    );
  }, []);

  const value = useMemo<Session>(
    () => ({
      token,
      user,
      signingIn,
      orderIds,
      signIn,
      signOut,
      rememberOrder,
      canSeeReports: user?.role === "organizer" || user?.role === "admin",
    }),
    [token, user, signingIn, orderIds, signIn, signOut, rememberOrder],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be called inside <SessionProvider>");
  return session;
}

/** Narrowed accessor for screens that only render when signed in. */
export function useSignedInSession(): Session & { token: string; user: User } {
  const session = useSession();
  if (!session.token || !session.user) throw new Error("Not signed in");
  return session as Session & { token: string; user: User };
}
