<script setup lang="ts">
/**
 * `hold-countdown` — how long the buyer has left (contract/testids.md requires
 * `data-seconds-remaining`).
 *
 * The number is RECOMPUTED from the server's `expires_at` on every tick, not
 * decremented locally, so a slow tab or a throttled timer cannot make the hold
 * look fresher than it is.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { HOLD_TTL_SECONDS } from "../lib/contract";

const props = defineProps<{ expiresAt: string }>();
const emit = defineEmits<{ expired: [] }>();

/**
 * Whole seconds between now and the hold's UTC expiry.
 *
 * Both sides of the subtraction are absolute instants, which is what makes the
 * answer independent of the browser's zone.
 */
function remainingSeconds(expiresAt: string): number {
  const millis = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(millis)) return 0;
  return Math.max(0, Math.floor(millis / 1000));
}

const left = ref(remainingSeconds(props.expiresAt));
let timer: number | undefined;

function stopTicking(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function startTicking(): void {
  stopTicking();
  left.value = remainingSeconds(props.expiresAt);
  timer = window.setInterval(() => {
    left.value = remainingSeconds(props.expiresAt);
    if (left.value === 0) {
      stopTicking();
      emit("expired");
    }
  }, 1000);
}

watch(() => props.expiresAt, startTicking, { immediate: true });
onBeforeUnmount(stopTicking);

const expired = computed(() => left.value === 0);

/** `mm:ss`, zero-padded, so 600 reads as `10:00` and 599 as `09:59`. */
const clock = computed(() => {
  const minutes = Math.floor(left.value / 60);
  const seconds = left.value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
});

const percentLeft = computed(() =>
  Math.min(100, Math.floor((left.value * 100) / HOLD_TTL_SECONDS)),
);
</script>

<template>
  <div
    class="countdown"
    :class="{ 'countdown--expired': expired }"
    data-testid="hold-countdown"
    :data-seconds-remaining="left"
    :data-expires-at="expiresAt"
    role="timer"
    aria-live="off"
  >
    <span class="countdown__label">{{ expired ? "Hold expired" : "Hold expires in" }}</span>
    <span class="countdown__value">{{ clock }}</span>
    <span class="countdown__bar" aria-hidden="true">
      <span class="countdown__bar-fill" :style="{ width: `${percentLeft}%` }" />
    </span>
  </div>
</template>
