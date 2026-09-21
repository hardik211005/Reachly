// Shared lint rules for every workspace. apps/web layers Next.js rules on top of these.
export const sharedRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/ban-ts-comment": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
  "no-console": ["warn", { allow: ["warn", "error"] }],
};

export const sharedIgnores = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/coverage/**",
  "**/generated/**",
  "**/prisma/migrations/**",
  "**/next-env.d.ts",
];
