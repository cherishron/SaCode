import { createApp } from "vue";
import { createPinia } from "pinia";
import TinyVue from "@opentiny/vue";
import App from "./App.vue";
import router from "./router";
import "./style.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(TinyVue);

app.mount("#app");
