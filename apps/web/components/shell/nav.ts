import type { ComponentType } from "react";
import { WhatsAppGlyph } from "../brand/brand-icon";
import {
  BarChart3,
  CreditCard,
  Home,
  Inbox,
  KanbanSquare,
  Lightbulb,
  Mail,
  Megaphone,
  Phone,
  Plug,
  Settings,
  Sprout,
  Telescope,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  /** A lucide icon, or a brand mark (e.g. WhatsApp) that takes the same className. */
  icon: ComponentType<{ className?: string }>;
  /** Keyboard shortcut after pressing "g". */
  shortcut?: string;
  /** Minimum role permission to show the item. */
  adminOnly?: boolean;
  /** Only for platform admins (PLATFORM_ADMIN_EMAILS). */
  platformOnly?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
  /** Folded away by default (remembered per browser); opens when one of its pages is active. */
  collapsible?: boolean;
}

/**
 * Grouped by what an owner is trying to do, in plain words: get customers, talk to them, win and
 * keep them, see results. Specialist screens live under "More tools" so the everyday menu stays short.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Today", href: "/app", icon: Home, shortcut: "o" }],
  },
  {
    label: "Get customers",
    items: [
      { label: "Find customers", href: "/app/discover", icon: Telescope, shortcut: "d" },
      { label: "Customer list", href: "/app/leads", icon: Users, shortcut: "l" },
    ],
  },
  {
    label: "Talk to them",
    items: [
      { label: "Replies", href: "/app/conversations", icon: Inbox, shortcut: "i" },
      { label: "Send offers", href: "/app/campaigns", icon: Megaphone, shortcut: "c" },
    ],
  },
  {
    label: "Win & keep them",
    items: [
      { label: "Deals & quotes", href: "/app/crm", icon: KanbanSquare, shortcut: "p" },
      { label: "Auto follow-ups", href: "/app/workflows", icon: Workflow, shortcut: "w" },
      { label: "Your page & reviews", href: "/app/grow", icon: Sprout, shortcut: "r" },
    ],
  },
  {
    label: "See results",
    items: [{ label: "Reports", href: "/app/analytics", icon: BarChart3, shortcut: "a" }],
  },
  {
    label: "More tools",
    collapsible: true,
    items: [
      { label: "Calls", href: "/app/calls", icon: Phone },
      { label: "Email", href: "/app/email", icon: Mail },
      { label: "WhatsApp", href: "/app/whatsapp", icon: WhatsAppGlyph },
      { label: "AI tips", href: "/app/ai-insights", icon: Lightbulb },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { label: "Connect apps", href: "/app/integrations", icon: Plug },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings, shortcut: "s" },
];

export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  ...NAV_FOOTER,
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
