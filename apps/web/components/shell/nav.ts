import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  CreditCard,
  Home,
  Inbox,
  KanbanSquare,
  Lightbulb,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Plug,
  Settings,
  Telescope,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Keyboard shortcut after pressing "g". */
  shortcut?: string;
  /** Minimum role permission to show the item. */
  adminOnly?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** Grouped by the job: find buyers, reach them, close and automate, then learn what worked. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Home", href: "/app", icon: Home, shortcut: "o" }],
  },
  {
    label: "Find",
    items: [
      { label: "Find leads", href: "/app/discover", icon: Telescope, shortcut: "d" },
      { label: "Leads", href: "/app/leads", icon: Users, shortcut: "l" },
    ],
  },
  {
    label: "Reach out",
    items: [
      { label: "Campaigns", href: "/app/campaigns", icon: Megaphone, shortcut: "c" },
      { label: "Inbox", href: "/app/conversations", icon: Inbox, shortcut: "i" },
      { label: "Calls", href: "/app/calls", icon: Phone },
      { label: "Email", href: "/app/email", icon: Mail },
      { label: "WhatsApp", href: "/app/whatsapp", icon: MessageCircle },
    ],
  },
  {
    label: "Close & automate",
    items: [
      { label: "CRM & quotes", href: "/app/crm", icon: KanbanSquare, shortcut: "p" },
      { label: "Workflows", href: "/app/workflows", icon: Workflow, shortcut: "w" },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/app/analytics", icon: BarChart3, shortcut: "a" },
      { label: "Insights", href: "/app/ai-insights", icon: Lightbulb },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { label: "Integrations", href: "/app/integrations", icon: Plug },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings, shortcut: "s" },
  { label: "System health", href: "/app/system", icon: Activity, adminOnly: true },
];

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_FOOTER];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
