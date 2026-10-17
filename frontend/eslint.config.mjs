// Next.js 16 removed the built-in `next lint` CLI command; ESLint now runs
// directly via `eslint .`, using eslint-config-next's flat-config export.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    settings: {
      react: {
        version: "19.0",
      },
    },
    rules: {
      "react/no-unescaped-entities": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["components/**/*.{js,jsx,ts,tsx}", "pages/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
