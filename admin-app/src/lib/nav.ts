import {
  LayoutDashboard,
  Inbox,
  Package,
  Clapperboard,
  SlidersHorizontal,
  Settings,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { canAccessSection, type Role, type Section } from './rbac';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  section: Section;
}
export interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

/** The top-level areas of the control center (Arabic-first, phone-first). */
export const NAV: NavGroup[] = [
  {
    titleKey: 'group_overview',
    items: [
      { href: '/dashboard', labelKey: 'nav_dashboard', icon: LayoutDashboard, section: 'dashboard' },
      { href: '/analytics', labelKey: 'nav_analytics', icon: BarChart3, section: 'analytics' },
      { href: '/inbox', labelKey: 'nav_inbox', icon: Inbox, section: 'inbox' },
    ],
  },
  {
    titleKey: 'group_catalog',
    items: [
      { href: '/catalog', labelKey: 'nav_catalog', icon: Package, section: 'catalog' },
      { href: '/content-studio', labelKey: 'nav_content_studio', icon: Clapperboard, section: 'content-studio' },
    ],
  },
  {
    titleKey: 'group_ai',
    items: [
      { href: '/ai-control', labelKey: 'nav_ai_control', icon: SlidersHorizontal, section: 'ai-control' },
    ],
  },
  {
    titleKey: 'group_system',
    items: [
      { href: '/settings', labelKey: 'nav_settings', icon: Settings, section: 'settings' },
    ],
  },
];

/** Nav groups filtered to the sections a role may enter (empty groups dropped). */
export function navForRole(role: Role): NavGroup[] {
  return NAV
    .map((group) => ({ ...group, items: group.items.filter((i) => canAccessSection(role, i.section)) }))
    .filter((group) => group.items.length > 0);
}
