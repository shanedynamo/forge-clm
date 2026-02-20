import type { Config } from "tailwindcss";
import { skeleton } from "@skeletonlabs/tw-plugin";

export default {
  content: [
    "./src/**/*.{html,js,svelte,ts}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#e7eaf0",
          100: "#c3c9d9",
          200: "#9ba6bf",
          300: "#7383a5",
          400: "#556991",
          500: "#374f7e",
          600: "#314876",
          700: "#293f6b",
          800: "#223661",
          900: "#15264e",
          950: "#0b1a38",
        },
        accent: {
          50: "#e3f2fd",
          100: "#bbdefb",
          200: "#90caf9",
          300: "#64b5f6",
          400: "#42a5f5",
          500: "#2196f3",
          600: "#1e88e5",
          700: "#1976d2",
          800: "#1565c0",
          900: "#0d47a1",
        },
      },
    },
  },
  plugins: [
    skeleton({ themes: { preset: ["skeleton"] } }),
  ],
} satisfies Config;
