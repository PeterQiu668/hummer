import { create } from 'zustand';
import type { ZoneId, Employee, ScreenView } from '../lib/types';

interface AppState {
  screen: ScreenView;
  setScreen: (s: ScreenView) => void;
  activeZone: ZoneId | null;
  setActiveZone: (z: ZoneId | null) => void;
  selectedEmployee: Employee | null;
  setSelectedEmployee: (e: Employee | null) => void;
  showMarketplace: boolean;
  setShowMarketplace: (v: boolean) => void;
  showGovernance: boolean;
  setShowGovernance: (v: boolean) => void;
  showHermes: boolean;
  setShowHermes: (v: boolean) => void;
  showMeeting: boolean;
  setShowMeeting: (v: boolean) => void;
  bootDone: boolean;
  setBootDone: (v: boolean) => void;
  leftNav: string;
  setLeftNav: (k: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'boot',
  setScreen: (screen) => set({ screen }),
  activeZone: null,
  setActiveZone: (activeZone) => set({ activeZone }),
  selectedEmployee: null,
  setSelectedEmployee: (selectedEmployee) => set({ selectedEmployee }),
  showMarketplace: false,
  setShowMarketplace: (showMarketplace) => set({ showMarketplace }),
  showGovernance: false,
  setShowGovernance: (showGovernance) => set({ showGovernance }),
  showHermes: false,
  setShowHermes: (showHermes) => set({ showHermes }),
  showMeeting: false,
  setShowMeeting: (showMeeting) => set({ showMeeting }),
  bootDone: false,
  setBootDone: (bootDone) => set({ bootDone }),
  leftNav: 'office',
  setLeftNav: (leftNav) => set({ leftNav }),
}));
