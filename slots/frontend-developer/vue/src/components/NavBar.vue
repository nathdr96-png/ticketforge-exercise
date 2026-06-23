<script setup lang="ts">
import { computed } from "vue";

import { hrefFor, useRoute } from "../lib/router";
import { useSession } from "../stores/session";

const route = useRoute();
const { user, logout, canSeeReports } = useSession();

/** An event page is still "events" as far as the nav is concerned. */
const active = computed(() => (route.value.name === "event" ? "events" : route.value.name));
</script>

<template>
  <header class="nav">
    <a class="nav__brand" :href="hrefFor({ name: 'events' })">TicketForge</a>
    <nav class="nav__links">
      <a
        class="nav__link"
        :class="{ 'nav__link--active': active === 'events' }"
        data-testid="nav-events"
        :href="hrefFor({ name: 'events' })"
        >Events</a
      >
      <a
        class="nav__link"
        :class="{ 'nav__link--active': active === 'orders' }"
        data-testid="nav-orders"
        :href="hrefFor({ name: 'orders' })"
        >Orders</a
      >
      <!--
        Revenue reporting is organizer/admin only, so a buyer gets no link at
        all. The route itself is guarded by the API, not by hiding this anchor —
        see ReportsView.vue.
      -->
      <a
        v-if="canSeeReports"
        class="nav__link"
        :class="{ 'nav__link--active': active === 'reports' }"
        data-testid="nav-reports"
        :href="hrefFor({ name: 'reports' })"
        >Revenue</a
      >
    </nav>
    <div class="nav__user">
      <span class="nav__email" data-testid="current-user" :data-role="user?.role">
        {{ user?.email }} &middot; {{ user?.role }}
      </span>
      <button class="button button--ghost" type="button" data-testid="logout" @click="logout">
        Sign out
      </button>
    </div>
  </header>
</template>
