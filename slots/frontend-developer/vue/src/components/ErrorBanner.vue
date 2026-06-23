<script setup lang="ts">
/**
 * The one `error-banner` on screen (contract/testids.md requires
 * `data-error-code`).
 *
 * Exactly one view renders at a time and each renders at most one of these, so
 * Playwright's strict mode can always resolve `getByTestId("error-banner")`
 * unambiguously. The code and the message are rendered as separate text nodes,
 * which is what keeps a banner from ever reading `[object Object]`.
 */
import type { DisplayError } from "../lib/errors";

defineProps<{ error: DisplayError | null }>();
defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div
    v-if="error"
    class="error-banner"
    role="alert"
    data-testid="error-banner"
    :data-error-code="error.code"
  >
    <div class="error-banner__body">
      <span class="error-banner__code">{{ error.code }}</span>
      <span class="error-banner__message">{{ error.message }}</span>
      <span v-if="error.details" class="error-banner__details">{{ error.details }}</span>
    </div>
    <button
      type="button"
      class="error-banner__close"
      aria-label="Dismiss error"
      @click="$emit('dismiss')"
    >
      &times;
    </button>
  </div>
</template>
