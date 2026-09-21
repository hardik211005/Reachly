import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  CreditCard,
  Home,
  Inbox,
  KanbanSquare,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Plug,
  Settings,
  Sparkles,
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Overview", href: "/app", icon: Home, shortcut: "o" },
      { label: "Discover", href: "/app/discover", icon: Telescope, shortcut: "d" },
      { label: "Leads", href: "/app/leads", icon: Users, shortcut: "l" },
      { label: "Campaigns", href: "/app/campaigns", icon: Megaphone, shortcut: "c" },
    ],
  },
  {
    label: "Engage",
    items: [
      { label: "Inbox", href: "/app/conversations", icon: Inbox, shortcut: "i" },
      { label: "Calls", href: "/app/calls", icon: Phone },
      { label: "Email", href: "/app/email", icon: Mail },
      { label: "WhatsApp", href: "/app/whatsapp", icon: MessageCircle },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { label: "CRM", href: "/app/crm", icon: KanbanSquare, shortcut: "p" },
      { label: "Workflows", href: "/app/workflows", icon: Workflow, shortcut: "w" },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/app/analytics", icon: BarChart3, shortcut: "a" },
      { label: "AI insights", href: "/app/ai-insights", icon: Sparkles },
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
