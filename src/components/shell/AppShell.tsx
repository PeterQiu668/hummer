import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { normalizeV3Page, useAppStore } from '../../store/useAppStore';
import LeftNav from './LeftNav';
import TopBar from './TopBar';
import WorkbenchPage from '../pages/WorkbenchPage';
import EmployeesPage from '../pages/EmployeesPage';
import MCPAppsPage from '../pages/MCPAppsPage';
import EvidencePage from '../pages/EvidencePage';
import CommandPalette from '../global/CommandPalette';
import ToastContainer from '../global/ToastContainer';
import MySettingsDrawer from '../../features/settings/MySettingsDrawer';

export default function AppShell() {
  const activePage = useAppStore((state) => state.activePage);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const currentPage = normalizeV3Page(activePage);

  useEffect(() => {
    if (currentPage !== activePage) setActivePage(currentPage);
  }, [activePage, currentPage, setActivePage]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-50">
      <TopBar />
      <LeftNav />
      <div className="absolute bottom-12 left-0 top-12 transition-[right,bottom] duration-300 md:bottom-0 md:left-60" style={{ right: 0 }}>
        {currentPage === 'office' && <WorkbenchPage />}
        {currentPage === 'employees' && <EmployeesPage />}
        {currentPage === 'connect' && <MCPAppsPage />}
        {currentPage === 'evidence' && <EvidencePage />}
      </div>

      <AnimatePresence>{settingsOpen && <MySettingsDrawer />}</AnimatePresence>
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
