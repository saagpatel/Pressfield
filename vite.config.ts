/// <reference types="vitest/config" />

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],

	// Vite options tailored for Tauri development, applied in `tauri dev`/`build`.
	// 1. Prevent Vite from obscuring Rust errors.
	clearScreen: false,
	// 2. Tauri expects a fixed port; fail if it is unavailable.
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		// 3. Ignore watching the Rust workspace.
		watch: { ignored: ["**/src-tauri/**"] },
	},

	// Vitest: pure unit tests run in Node; component tests add jsdom in Phase 1.
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
	},
});
