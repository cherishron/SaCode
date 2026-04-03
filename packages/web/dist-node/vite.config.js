import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:3000",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    // Vue 核心
                    if (id.includes("node_modules/vue/")) {
                        return "vue";
                    }
                    // Vue 生态 (vue-router, pinia)
                    if (id.includes("node_modules/vue-router/") || id.includes("node_modules/pinia/")) {
                        return "vue-ecosystem";
                    }
                    // TinyVue 组件库
                    if (id.includes("@opentiny/vue")) {
                        return "tinyvue";
                    }
                    // TinyVue 图标
                    if (id.includes("@opentiny/vue-icon")) {
                        return "tinyvue-icon";
                    }
                },
            },
        },
        chunkSizeWarningLimit: 1000,
    },
});
