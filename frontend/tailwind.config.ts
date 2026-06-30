import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          50:  "#f0f7f0",
          100: "#e8f3e8",
          200: "#c8dfc8",
          300: "#9dc49d",
          400: "#4caf70",
          500: "#227239",
          600: "#1a5a2c",
          700: "#144521",
          800: "#0e3018",
          900: "#081a0c",
        },
      },
      fontFamily: {
        display: ["'Lora'", "serif"],
        body:    ["'Nunito'", "sans-serif"],
        mono:    ["'JetBrains Mono'", "monospace"],
      },
      animation: {
        "fade-in":  "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "grow":     "grow 0.6s ease-out",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(16px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        grow:    { "0%": { transform: "scaleX(0)" }, "100%": { transform: "scaleX(1)" } },
      },
    },
  },
  plugins: [],
};
export default config;
