import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { sharedIgnores, sharedRules } from "./eslint.base.mjs";

export default tseslint.config(
  { ignores: [...sharedIgnores, "apps/web/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: sharedRules },
  {
    files: ["**/scripts/**", "**/prisma/seed*.ts", "apps/worker/**"],
    rules: { "no-console": "off" },
  },
);
