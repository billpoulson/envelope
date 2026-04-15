import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "rgb(22 28 36 / <alpha-value>)",
        border: "rgb(55 65 81 / <alpha-value>)",
        accent: "rgb(91 140 255 / <alpha-value>)",
      },
    },
  },
  plugins: [typography],
};
