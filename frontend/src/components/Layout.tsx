import { Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="h-full w-full overflow-hidden bg-[#02070c]">
      <Outlet />
    </div>
  );
}
