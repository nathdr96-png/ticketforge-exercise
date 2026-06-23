import { createApp } from "vue";

import App from "./App.vue";
import "./styles.css";

const container = document.getElementById("app");
if (!container) throw new Error("#app container missing from index.html");

createApp(App).mount(container);
