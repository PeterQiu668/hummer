import { AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import LeftNav from './LeftNav';
import TopBar from './TopBar';
import RightConsole from './RightConsole';
import BottomFlow from './BottomFlow';
import OfficeStage3D from '../office/OfficeStage3D';
import EmployeeDrawer from '../drawer/EmployeeDrawer';
import Marketplace from '../marketplace/Marketplace';
import GovernanceCabin from '../hiclaw/GovernanceCabin';
import EvolutionFlywheel from '../hermes/EvolutionFlywheel';
import MeetingRoom from '../meeting/MeetingRoom';
import KnowledgeGraph from '../kg/KnowledgeGraph';
import LobsterLab from '../lobster/LobsterLab';
import SkillSlotIn from '../lobster/SkillSlotIn';
import TasksPage from '../pages/TasksPage';
import EmployeesPage from '../pages/EmployeesPage';
import SkillsPage from '../pages/SkillsPage';
import MCPAppsPage from '../pages/MCPAppsPage';
import AuditPage from '../pages/AuditPage';
import ChatPage from '../pages/ChatPage';
import KnowledgeHubPage from '../pages/KnowledgeHubPage';
import EvidencePage from '../pages/EvidencePage';
import ExecutiveDetail from '../exec/ExecutiveDetail';
import CommandPalette from '../global/CommandPalette';
import ToastContainer from '../global/ToastContainer';

export default function AppShell() {
  const activePage = useAppStore((s) => s.activePage);
  const selectedEmployee = useAppStore((s) => s.selectedEmployee);
  const showMarketplace = useAppStore((s) => s.showMarketplace);
  const showGovernance = useAppStore((s) => s.showGovernance);
  const showHermes = useAppStore((s) => s.showHermes);
  const showMeeting = useAppStore((s) => s.showMeeting);
  const showKG = useAppStore((s) => s.showKG);
  const showLobsterLab = useAppStore((s) => s.showLobsterLab);
  const activeExecId = useAppStore((s) => s.activeExecId);

  const isOffice = activePage === 'office';
  // 右侧槽位优先级：选中 Agent → 显示 Drawer；否则在办公室页显示 RightConsole；其他页隐藏
  const rightSlotVisible = (isOffice && !selectedEmployee) || (isOffice && !!selectedEmployee);
  const rightWidth = selectedEmployee ? 380 : 320;
  // 底部 IM 流只在办公室页展示
  const bottomVisible = isOffice;

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-50">
      {/* Top */}
      <TopBar />

      {/* Left */}
      <LeftNav />

      {/* Right slot — EmployeeDrawer or RightConsole (mutually exclusive) */}
      {isOffice && !selectedEmployee && <RightConsole />}
      {/* EmployeeDrawer renders inside right slot when an Agent is selected */}
      <AnimatePresence>{selectedEmployee && <EmployeeDrawer />}</AnimatePresence>

      {/* Bottom flow (only on office page) */}
      {bottomVisible && <BottomFlow />}

      {/* Center workspace area */}
      <div
        className="absolute top-12 left-60 bottom-0 transition-[right,bottom] duration-300"
        style={{
          right: rightSlotVisible ? `${rightWidth}px` : 0,
          bottom: bottomVisible ? '276px' : 0,
        }}
      >
        {activePage === 'office' && <OfficeStage3D />}
        {activePage === 'tasks' && <TasksPage />}
        {activePage === 'employees' && <EmployeesPage />}
        {activePage === 'skills' && <SkillsPage />}
        {activePage === 'connect' && <MCPAppsPage />}
        {activePage === 'audit' && <AuditPage />}
        {activePage === 'chat' && <ChatPage />}
        {activePage === 'kg' && <KnowledgeHubPage />}
        {activePage === 'evidence' && <EvidencePage />}
      </div>

      {/* Modals (full-screen overlays) */}
      <AnimatePresence>{showMarketplace && <Marketplace />}</AnimatePresence>
      <AnimatePresence>{showGovernance && <GovernanceCabin />}</AnimatePresence>
      <AnimatePresence>{showHermes && <EvolutionFlywheel />}</AnimatePresence>
      <AnimatePresence>{showMeeting && <MeetingRoom />}</AnimatePresence>
      <AnimatePresence>{showKG && <KnowledgeGraph />}</AnimatePresence>
      <AnimatePresence>{showLobsterLab && <LobsterLab />}</AnimatePresence>
      <AnimatePresence>{activeExecId && <ExecutiveDetail />}</AnimatePresence>

      {/* Global overlays */}
      <SkillSlotIn />
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
