import { NavLink } from 'react-router-dom';
import { MessageSquare, Brain, BarChart3, FolderTree } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

const tabs = [
  { to: '/sessions', label: 'Sessions', icon: MessageSquare },
  { to: '/memory', label: 'Memory', icon: Brain },
  { to: '/artifacts', label: 'Artifacts', icon: FolderTree },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
];

export default function Layout({ children }: Props) {
  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="flex items-center gap-6 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <span className="text-lg font-semibold tracking-tight text-gray-900">
          cc-manage
        </span>
        <nav className="flex gap-1">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
