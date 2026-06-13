import { NavLink } from 'react-router-dom';
import { MessageSquare, Brain, BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

const tabs = [
  { to: '/sessions', label: 'Sessions', icon: MessageSquare },
  { to: '/memory', label: 'Memory', icon: Brain },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
];

export default function Layout({ children }: Props) {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-6 px-6 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="text-lg font-semibold tracking-tight text-zinc-100">
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
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
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
