import { describe, expect, it } from "vitest";
import { assignableRoles, permissionsFor, roleHas, scopesAllow } from "./rbac";

describe("RBAC", () => {
  it("gives viewers read-only access", () => {
    expect(roleHas("VIEWER", "leads:read")).toBe(true);
    expect(roleHas("VIEWER", "leads:write")).toBe(false);
    expect(roleHas("VIEWER", "outreach:send")).toBe(false);
  });

  it("restricts billing to owners", () => {
    expect(roleHas("OWNER", "billing:manage")).toBe(true);
    expect(roleHas("ADMIN", "billing:manage")).toBe(false);
    expect(roleHas("ADMIN", "members:manage")).toBe(true);
    expect(roleHas("MEMBER", "members:manage")).toBe(false);
  });

  it("orders roles as a strict hierarchy", () => {
    const viewer = new Set(permissionsFor("VIEWER"));
    const member = new Set(permissionsFor("MEMBER"));
    const admin = new Set(permissionsFor("ADMIN"));
    const owner = new Set(permissionsFor("OWNER"));
    expect([...viewer].every((p) => member.has(p))).toBe(true);
    expect([...member].every((p) => admin.has(p))).toBe(true);
    expect([...admin].every((p) => owner.has(p))).toBe(true);
  });

  it("limits which roles can be assigned", () => {
    expect(assignableRoles("ADMIN")).not.toContain("OWNER");
    expect(assignableRoles("MEMBER")).toEqual([]);
  });

  it("maps API key scopes", () => {
    expect(scopesAllow(["read"], "leads:read")).toBe(true);
    expect(scopesAllow(["read"], "leads:write")).toBe(false);
    expect(scopesAllow(["write"], "leads:write")).toBe(true);
    expect(scopesAllow(["write"], "billing:manage")).toBe(false);
  });
});
