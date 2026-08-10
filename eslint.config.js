import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "server-dist/**", "node_modules/**", "app.js"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/**/*.ts"],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ["src/server/**/*.ts", "src/**/*.test.ts", "vite.config.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  }
);
