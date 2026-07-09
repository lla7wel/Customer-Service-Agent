import {
  LayoutDashboard,
  Inbox,
  Package,
  ClipboardCheck,
  Megaphone,
  SlidersHorizontal,
  FlaskConical,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
}
export interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

/** Sidebar structure for the control-center sections (one-person operator). */
export const NAV: NavGroup[] = [
  {
    titleKey: 'group_overview',
    items: [{ href: '/dashboard', labelKey: 'nav_dashboard', icon: LayoutDashboard }],
  },
  {
    titleKey: 'group_inbox',
    items: [
      { href: '/inbox', labelKey: 'nav_inbox', icon: Inbox },
    ],
  },
  {
    titleKey: 'group_catalog',
    items: [
      { href: '/products', labelKey: 'nav_products', icon: Package },
      { href: '/catalog-review', labelKey: 'nav_catalog_review', icon: ClipboardCheck },
    ],
  },
  {
    titleKey: 'group_marketing',
    items: [
      { href: '/campaigns', labelKey: 'nav_campaigns', icon: Megaphone },
    ],
  },
  {
    titleKey: 'group_ai',
    items: [
      { href: '/ai-control', labelKey: 'nav_ai_control', icon: SlidersHorizontal },
      { href: '/ai-playground', labelKey: 'nav_ai_playground', icon: FlaskConical },
    ],
  },
  {
    titleKey: 'group_system',
    items: [
      { href: '/settings', labelKey: 'nav_settings', icon: Settings },
    ],
  },
];
