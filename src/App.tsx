import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from './store/useAppStore';
import BootScreen from './components/boot/BootScreen';
import AppShell from './components/shell/AppShell';
import RuntimeSetupGate from './components/boot/RuntimeSetupGate';

export default function App() {
  const bootDone = useAppStore((s) => s.bootDone);
  const setBootDone = useAppStore((s) => s.setBootDone);
  const setScreen = useAppStore((s) => s.setScreen);

  useEffect(() => {
    if (!bootDone) setScreen('boot');
  }, [bootDone, setScreen]);

  return (
    <RuntimeSetupGate><div className="relative h-full w-full overflow-hidden">
      <AnimatePresence mode="wait">
        {!bootDone ? (
          <motion.div
            key="boot"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0"
          >
            <BootScreen
              onDone={() => {
                setBootDone(true);
                setScreen('office');
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="shell"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <AppShell />
          </motion.div>
        )}
      </AnimatePresence>
    </div></RuntimeSetupGate>
  );
}
