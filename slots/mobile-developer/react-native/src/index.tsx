import { AppRegistry } from "react-native";

import App from "./App";
import appConfig from "../app.json";

/**
 * Entry point.
 *
 * `AppRegistry.registerComponent` is React Native's own entry convention — the
 * same call `index.js` makes in a bare RN project — so the app is registered
 * under the name in `app.json` whatever the platform. `runApplication` is the
 * web host's half: on a device the native runtime calls the registry instead,
 * and nothing in `src/` changes.
 */
AppRegistry.registerComponent(appConfig.name, () => App);

const rootTag = document.getElementById("root");
if (!rootTag) throw new Error("#root is missing from index.html");

AppRegistry.runApplication(appConfig.name, { rootTag });
