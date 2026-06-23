/**
 * Auth session, as a module-scope store.
 *
 * Three refs created once at module scope ARE the store — no Pinia, no provide/
 * inject ceremony, and nothing to wire up in `main.ts`. Any component that calls
 * `useSession()` reads the same refs, which is all a single-session buyer app
 * needs and keeps the bundle at vue-and-nothing-else.
 *
 * The token is kept in `localStorage` so that opening a deep link such as
 * `#/reports` in a new tab stays authenticated instead of bouncing to the login
 * form. Every access is guarded: in a private window `localStorage` can throw,
 * and a session that merely does not persist is better than a blank page.
 */

import { computed, ref, type ComputedRef, type Ref } from "vue";

import { api, ApiError } from "../lib/api";
import type { User } from "../lib/contract";

const TOKEN_KEY = "ticketforge.token";
const USER_KEY = "ticketforge.user";
const ORDER_IDS_KEY = "ticketforge.orderIds";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the session simply does not survive a reload */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const token = ref<string | null>(readRaw(TOKEN_KEY));
const user = ref<User | null>(readJson<User | null>(USER_KEY, null));
const orderIds = ref<string[]>(readJson<string[]>(ORDER_IDS_KEY, []));
const loggingIn = ref(false);

const canSeeReports = computed(
  () => user.value?.role === "organizer" || user.value?.role === "admin",
);

/** Throws an `ApiError` the caller is expected to show in the error banner. */
async function login(email: string, password: string): Promise<void> {
  loggingIn.value = true;
  try {
    const result = await api.login(email, password);
    if (!result?.token) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login did not return a token");
    }
    token.value = result.token;
    user.value = result.user;
    writeRaw(TOKEN_KEY, result.token);
    writeRaw(USER_KEY, JSON.stringify(result.user));
  } finally {
    loggingIn.value = false;
  }
}

function logout(): void {
  token.value = null;
  user.value = null;
  writeRaw(TOKEN_KEY, null);
  writeRaw(USER_KEY, null);
}

/**
 * The contract has no "list my orders" endpoint, so the browser remembers the
 * ids it created and re-reads each one with `GET /orders/{id}`.
 */
function rememberOrder(orderId: string): void {
  if (orderIds.value.includes(orderId)) return;
  orderIds.value = [orderId, ...orderIds.value];
  writeRaw(ORDER_IDS_KEY, JSON.stringify(orderIds.value));
}

export interface Session {
  token: Ref<string | null>;
  user: Ref<User | null>;
  loggingIn: Ref<boolean>;
  orderIds: Ref<string[]>;
  canSeeReports: ComputedRef<boolean>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  rememberOrder: (orderId: string) => void;
}

export function useSession(): Session {
  return { token, user, loggingIn, orderIds, canSeeReports, login, logout, rememberOrder };
}

/**
 * The token, for a view that is only ever rendered behind the auth gate in
 * App.vue. Throwing here is a programming error, not a user-facing one.
 */
export function requireToken(): string {
  if (!token.value) throw new Error("requireToken() called outside an authenticated view");
  return token.value;
}
