// tailwind.config.js
import { fontFamily } from "tailwindcss/defaultTheme";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{html,js,svelte,ts,tsx}"],
  corePlugins: {
    preflight: false, // Uncomment if you want to disable Tailwind’s base resets
  },
  safelist: ["dark"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
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
        red: "var(--color-red)",
        "red-rgb": "rgba(var(--color-red-rgb),<alpha-value>)",
        orange: "var(--color-orange)",
        "orange-rgb": "rgba(var(--color-orange-rgb),<alpha-value>)",
        yellow: "var(--color-yellow)",
        "yellow-rgb": "rgba(var(--color-yellow-rgb),<alpha-value>)",
        green: "var(--color-green)",
        "green-rgb": "rgba(var(--color-green-rgb),<alpha-value>)",
        cyan: "var(--color-cyan)",
        "cyan-rgb": "rgba(var(--color-cyan-rgb),<alpha-value>)",
        blue: "var(--color-blue)",
        "blue-rgb": "rgba(var(--color-blue-rgb),<alpha-value>)",
        purple: "var(--color-purple)",
        "purple-rgb": "rgba(var(--color-purple-rgb),<alpha-value>)",
        pink: "var(--color-pink)",
        "pink-rgb": "rgba(var(--color-pink-rgb),<alpha-value>)",
        gray: "var(--color-gray)",

        border: "var(--background-modifier-border)",
        input: "var(--background-form-field)",
        ring: "var(--interactive-accent)",
        background: "var(--background-primary)",
        foreground: "var(--text-normal)",

        primary: {
          DEFAULT: "var(--interactive-accent)",
          foreground: "var(--text-on-accent)",
        },
        secondary: {
          DEFAULT: "var(--interactive-normal)",
          foreground: "var(--text-on-accent)",
        },
        destructive: {
          DEFAULT: "var(--text-error)",
          foreground: "var(--text-on-accent-inverted)",
        },
        muted: {
          DEFAULT: "var(--text-faint)",
          foreground: "var(--text-faint)",
        },
        accent: {
          DEFAULT: "var(--text-accent)",
          foreground: "var(--text-on-accent)",
        },
        popover: {
          DEFAULT: "var(--background-secondary)",
          foreground: "var(--text-normal)",
        },
        card: {
          DEFAULT: "var(--background-primary-alt)",
          foreground: "var(--text-normal)",
        },
        sidebar: {
          DEFAULT: "var(--background-secondary)",
          foreground: "var(--text-normal)",
          primary: "var(--interactive-accent)",
          "primary-foreground": "var(--text-on-accent)",
          accent: "var(--text-accent)",
          "accent-foreground": "var(--text-on-accent-inverted)",
          border: "var(--background-modifier-border)",
          ring: "var(--interactive-accent)",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "clickable-icon": "var(--clickable-icon-radius)",
        s: "var(--radius-s)",
        m: "var(--radius-m)",
        l: "var(--radius-l)",
        "xl-obsidian": "var(--radius-xl)",
      },
      fontFamily: {
        sans: [...fontFamily.sans],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--bits-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--bits-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
      borderWidth: {
        DEFAULT: "var(--border-width)",
      },
    },
  },
  plugins: [tailwindcssAnimate, require("@tailwindcss/typography")],
};
