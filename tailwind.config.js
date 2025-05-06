// tailwind.config.js
import { fontFamily } from "tailwindcss/defaultTheme";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{html,js,svelte,ts,tsx}"],
  corePlugins: {
    // Keep preflight disabled so Tailwind won't reset Obsidian’s base styles
    preflight: false,
  },
  safelist: ["dark"],
  theme: {
    extend: {
      // Create "obsidian" namespace for Obsidian CSS variables
      obs: {
        // Colors
        colors: {
          // Base colors
          base: {
            "00": "var(--color-base-00)",
            "05": "var(--color-base-05)",
            10: "var(--color-base-10)",
            20: "var(--color-base-20)",
            25: "var(--color-base-25)",
            30: "var(--color-base-30)",
            35: "var(--color-base-35)",
            40: "var(--color-base-40)",
            50: "var(--color-base-50)",
            60: "var(--color-base-60)",
            70: "var(--color-base-70)",
            100: "var(--color-base-100)",
          },
        },
        text: {
          normal: "var(--text-normal)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
          error: "var(--text-error)",
          "on-accent": "var(--text-on-accent)",
          accent: "var(--text-accent)",
        },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [tailwindcssAnimate, require("@tailwindcss/typography")],
};
