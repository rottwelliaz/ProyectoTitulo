import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        primary: "#1F2937",
        secondary: "#F59E0B",
        accent: "#EF4444",
      },
    },
  },
  plugins: [],
};
