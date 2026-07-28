import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Series palette. Contrast checked against #ffffff / #0b1220 backgrounds.
        ink: "#0b1220",
        parchment: "#f7f4ed",
        indigo: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        serif: ["ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
