import {
  LayoutDashboard,
  Inbox,
  Package,
  Clapperboard,
  SlidersHorizontal,
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

/** The seven top-level areas of the control center (Arabic-first, phone-first). */
export const NAV: NavGroup[] = [
  {
    titleKey: 'group_overview',
    items: [
      { href: '/dashboard', labelKey: 'nav_dashboard', icon: LayoutDashboard },
      { href: '/inbox', labelKey: 'nav_inbox', icon: Inbox },
    ],
  },
  {
    titleKey: 'group_catalog',
    items: [
      { href: '/catalog', labelKey: 'nav_catalog', icon: Package },
      { href: '/content-studio', labelKey: 'nav_content_studio', icon: Clapperboard },
    ],
  },
  {
    titleKey: 'group_ai',
    items: [
      { href: '/ai-control', labelKey: 'nav_ai_control', icon: SlidersHorizontal },
    ],
  },
  {
    titleKey: 'group_system',
    items: [
      { href: '/settings', labelKey: 'nav_settings', icon: Settings },
    ],
  },
];
