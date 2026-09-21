/** Text helpers shared by services. */

export function slugify(input: string, maxLength = 48): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "workspace";
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Replaces {{variable}} placeholders; unknown variables are left visible so users notice them. */
export function renderTemplate(template: string, variables: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null || value === "" ? match : String(value);
  });
}

export function firstName(fullName: string | null | undefined): string | undefined {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : undefined;
}
