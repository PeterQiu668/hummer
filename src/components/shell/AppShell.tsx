import { AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import LeftNav from './LeftNav';
import TopHUD from './TopHUD';
import RightConsole from './RightConsole';
import BottomFlow from './BottomFlow';
import OfficeImage from '../office/OfficeImage';
import EmployeeDrawer from '../drawer/EmployeeDrawer';
import Marketplace from '../marketplace/Marketplace';
import GovernanceCabin from '../hiclaw/GovernanceCabin';
import EvolutionFlywheel from '../hermes/EvolutionFlywheel';
import MeetingRoom from '../meeting/MeetingRoom';

export default function AppShell() {
  const { selectedEmployee, showMarketplace, showGovernance, showHermes, showMeeting } =
    useAppStore();

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Background ambient layers */}
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="scanline-overlay opacity-50" />

      {/* Top HUD */}
      <TopHUD />

      {/* Left sidebar */}
      <LeftNav />

      {/* Right console */}
      <RightConsole />

      {/* Bottom flow */}
      <BottomFlow />

      {/* Center Office (Image v2 with 25 workstations) */}
      <div className="absolute inset-0 top-14 bottom-72 left-64 right-80">
        <OfficeImage />
      </div>

      {/* Drawers / Modals */}
      <AnimatePresence>{selectedEmployee && <EmployeeDrawer />}</AnimatePresence>
      <AnimatePresence>{showMarketplace && <Marketplace />}</AnimatePresence>
      <AnimatePresence>{showGovernance && <GovernanceCabin />}</AnimatePresence>
      <AnimatePresence>{showHermes && <EvolutionFlywheel />}</AnimatePresence>
      <AnimatePresence>{showMeeting && <MeetingRoom />}</AnimatePresence>
    </div>
  );
}
