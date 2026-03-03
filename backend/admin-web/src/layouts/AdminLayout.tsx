import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('adminKey');
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: '대시보드', icon: '📊' },
    { path: '/events', label: '이벤트 관리', icon: '🎫' },
    { path: '/events/create', label: '이벤트 추가', icon: '➕' },
    { path: '/hot-suggestions', label: 'Hot Suggestions', icon: '🔥' },
    { path: '/curation-themes', label: '홈 큐레이션', icon: '🗂️' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Fairpick Admin</h1>
            <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full font-medium">
              Live
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)] sticky top-[73px]">
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors
                    ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 border-l-4 border-primary-600'
                        : 'text-gray-700 hover:bg-gray-50'
                    }
                  `}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

