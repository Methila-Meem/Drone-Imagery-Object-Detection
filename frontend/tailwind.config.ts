import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f8fafc",
        ink: "#172033",
        muted: "#64748b",
        line: "#d8dee8",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;

