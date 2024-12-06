module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}", // Include the app directory
    "./pages/**/*.{js,ts,jsx,tsx}", // Fallback for older pages directory
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
