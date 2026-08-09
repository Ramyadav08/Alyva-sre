import type { Config } from "tailwindcss";

// Brand tokens ported from reference/sreoncall/packages/web/app/globals.css
// ("SREonCall Design System v1.0") — values copied, app not run/extended.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        brand: {
          DEFAULT: "#FF6B2B",
          400: "#FF8F4F",
          600: "#E85D1C",
        },
        navy: {
          900: "#0D1117",
          800: "#1E3A5F",
          surface: "#161B22",
          elevated: "#1E293B",
          overlay: "#334155",
        },
        success: "#16A34A",
        warning: "#EAB308",
        error: "#DC2626",
        info: "#2563EB",
        ai: "#7C3AED",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
