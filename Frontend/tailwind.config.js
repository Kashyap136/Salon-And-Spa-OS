/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
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
