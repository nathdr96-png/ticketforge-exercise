<script setup lang="ts">
/**
 * The auth gate and the router outlet.
 *
 * Unauthenticated means exactly one thing on screen: the login form. No nav, no
 * event list container, nothing a suite could mistake for a partially logged-in
 * state. Authenticated, the hash route picks a view — including `#/reports`,
 * which is rendered for anybody who asks for it precisely so that the API's 403
 * is what refuses them rather than a client-side redirect that merely hides it.
 */
import { computed, watch } from "vue";

import { navigate, useRoute } from "./lib/router";
import { useSession } from "./stores/session";
import EventsView from "./components/EventsView.vue";
import EventView from "./components/EventView.vue";
import LoginView from "./components/LoginView.vue";
import NavBar from "./components/NavBar.vue";
import OrdersView from "./components/OrdersView.vue";
import ReportsView from "./components/ReportsView.vue";

const route = useRoute();
const { token, user } = useSession();

const authed = computed(() => Boolean(token.value && user.value));
/** Empty unless the route IS an event route; keeps the template free of casts. */
const eventId = computed(() => (route.value.name === "event" ? route.value.eventId : ""));

// Someone who is already signed in and lands on #/login belongs on the events
// list; everything else is left exactly where the URL points.
watch([authed, route], () => {
  if (authed.value && route.value.name === "login") navigate({ name: "events" });
});
</script>

<template>
  <LoginView v-if="!authed" />
  <div v-else class="shell">
    <NavBar />
    <EventView v-if="route.name === 'event'" :key="eventId" :event-id="eventId" />
    <OrdersView v-else-if="route.name === 'orders'" />
    <ReportsView v-else-if="route.name === 'reports'" />
    <EventsView v-else />
  </div>
</template>
