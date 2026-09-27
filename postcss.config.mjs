// Tailwind CSS v4 plugs into PostCSS with this single plugin.
// There is no tailwind.config.js — styling utilities are configured in
// src/app/globals.css instead.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
