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
    extend: {},
  },
  variants: {
    extend: {},
  },
  plugins: [tailwindcssAnimate, require("@tailwindcss/typography")],
};
