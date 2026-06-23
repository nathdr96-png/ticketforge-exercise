<script setup lang="ts">
import { ref } from "vue";

import { toDisplayError, type DisplayError } from "../lib/errors";
import { useSession } from "../stores/session";
import ErrorBanner from "./ErrorBanner.vue";

const { login, loggingIn } = useSession();

const email = ref("");
const password = ref("");
const error = ref<DisplayError | null>(null);

/**
 * A rejected login must surface the contract's code and leave the buyer on this
 * form — never a blank page, and never a half-authenticated shell.
 */
async function submit(): Promise<void> {
  error.value = null;
  try {
    await login(email.value, password.value);
  } catch (cause) {
    error.value = toDisplayError(cause);
  }
}
</script>

<template>
  <main class="login">
    <div class="card login__card">
      <h1 class="login__title">TicketForge</h1>
      <p class="login__subtitle">Sign in to browse events and buy seats.</p>

      <ErrorBanner :error="error" @dismiss="error = null" />

      <form class="login__form" novalidate @submit.prevent="submit">
        <label class="field">
          <span class="field__label">Email</span>
          <input
            v-model="email"
            class="field__input"
            data-testid="login-email"
            type="email"
            name="email"
            autocomplete="username"
            placeholder="buyer01@ticketforge.test"
          />
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input
            v-model="password"
            class="field__input"
            data-testid="login-password"
            type="password"
            name="password"
            autocomplete="current-password"
            placeholder="password123"
          />
        </label>
        <button
          class="button button--primary"
          data-testid="login-submit"
          type="submit"
          :disabled="loggingIn"
        >
          {{ loggingIn ? "Signing in…" : "Sign in" }}
        </button>
      </form>
    </div>
  </main>
</template>
