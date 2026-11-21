import React from 'react';
import { AppProvider, useAppStore } from '@/lib/store';
import { LoginView } from '@/components/LoginView';
import { AdminDashboard } from '@/components/AdminDashboard';
import { RiderMobileView } from '@/components/RiderMobileView';
import { Toaster } from '@/components/ui/primitives';

const AppShell: React.FC = () => {
  const { currentUser, isLoading, toasts, dismissToast } = useAppStore();

  return (
    <>
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-200">
          <div className="text-center space-y-2">
            <div className="h-10 w-10 rounded-xl bg-amber-500 text-zinc-950 font-black flex items-center justify-center mx-auto animate-pulse">
              H
            </div>
            <p className="text-sm font-medium text-zinc-400">
              Connessione in tempo reale in corso...
            </p>
          </div>
        </div>
      ) : !currentUser ? (
        <LoginView />
      ) : currentUser.role === 'admin' ? (
        <AdminDashboard />
      ) : (
        <RiderMobileView />
      )}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
};

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default App;
