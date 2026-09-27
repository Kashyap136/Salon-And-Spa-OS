/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      // Two extra screen tokens so "collapse the side-by-side layouts" and
      // "compact everything for the ultra-narrow band" are named decisions
      // instead of scattered ad-hoc `min-[...px]:` variants.
      //
      // narrow: below this a two-up form row squeezes each control to less than
      //         the width of its own longest word, so pairs stack instead.
      // tiny:   below the narrowest real handset, padding/type/control sizing
      //         step down so a single word still fits its column.
      screens: {
        narrow: "380px",
        tiny: "220px",
      },
      colors: {
        ledger: {
          base: "#2A0F1C",
          panel: "#3D1A2B",
          panelLight: "#4A2033",
          rule: "#8A5A6C",
          cream: "#F3E9DE",
          creamDim: "#D9C7B8",
          gold: "#C9A15A",
          goldBright: "#E0BD7C",
          rose: "#D46A85",
        },
        status: {
          go: "#4F9A6A",
          pending: "#D6A24B",
          stop: "#C1554A",
        },
      },
      fontFamily: {
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        body: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
