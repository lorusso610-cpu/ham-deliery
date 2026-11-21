import React, { useEffect, useState } from 'react';
import {
  Bike,
  ChevronDown,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  UserCheck,
  Zap,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Badge, Button, Card } from '@/components/ui/primitives';

export const LoginView: React.FC = () => {
  const { db, loginWithPin, loginAsUser, theme, toggleTheme, isRealtimeSupabase } =
    useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeUsers = db.users.filter((u) => u.is_active);
  const adminUsers = activeUsers.filter((u) => u.role === 'admin');
  const riderUsers = activeUsers
    .filter((u) => u.role === 'rider')
    .sort((a, b) => (a.rider_number ?? 99) - (b.rider_number ?? 99));

  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    () => activeUsers[0]?.id ?? ''
  );

  const selectedProfile =
    activeUsers.find((u) => u.id === selectedProfileId) ?? activeUsers[0] ?? null;

  useEffect(() => {
    if (!selectedProfileId && activeUsers[0]?.id) {
      setSelectedProfileId(activeUsers[0].id);
    }
  }, [activeUsers, selectedProfileId]);

  const handleDropdownLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProfile) return;
    setSubmitting(true);
    setError(null);
    const res = isRealtimeSupabase
      ? await loginWithPin(selectedProfile.pin_code)
      : await loginAsUser(selectedProfile.id);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? 'Impossibile accedere con il profilo selezionato');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#ededee] dark:bg-[#0b0b0d] px-4 py-6 sm:py-10 transition-colors">
      {/* Top Bar */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[#141414] text-white dark:bg-[#f4f4f6] dark:text-[#121212] flex items-center justify-center font-bold text-base">
            H
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base tracking-tight text-zinc-950 dark:text-zinc-50">
                HAM Delivery
              </span>
              <Badge variant={isRealtimeSupabase ? 'green' : 'neutral'}>
                <Zap className="h-3 w-3" />
                {isRealtimeSupabase ? 'Supabase Live' : 'Real-Time'}
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Via Golgota 86, Altamura
            </p>
          </div>
        </div>

        {/* 4. Toggle Switch fluido per Light / Dark */}
        <button
          type="button"
          onClick={toggleTheme}
          className="h-9 px-3 rounded-full border border-zinc-300/80 dark:border-zinc-800 bg-white dark:bg-[#141417] flex items-center gap-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:border-zinc-900 dark:hover:border-zinc-500 transition-all"
          aria-label="Cambia tema Light / Dark"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="h-3.5 w-3.5" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5" />
              <span>Dark</span>
            </>
          )}
        </button>
      </div>

      {/* Center Card — Two-Tone Clean Monochrome ("Analytics" screen style) */}
      <div className="max-w-md w-full mx-auto my-6">
        <Card className="overflow-hidden rounded-[34px] p-0 border-zinc-200/90 dark:border-zinc-800 erp-card-lift">
          {/* Top Dark Header Block (like the "Analytics / $ 2,500" reference card) */}
          <div className="bg-[#141414] text-white px-7 pt-7 pb-6">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-5">
              <span>HAM • Altamura</span>
              <span className="inline-flex items-center gap-1.5 text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sessione Attiva
              </span>
            </div>
            <p className="text-xs font-medium text-zinc-400">
              Piattaforma Consegne &amp; Cassa
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1">
              Seleziona il tuo profilo
            </h1>
          </div>

          {/* Clean Light/Dark Body */}
          <div className="p-7 bg-white dark:bg-[#141417]">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300 animate-validation-shake">
                {error}
              </div>
            )}

            <form onSubmit={handleDropdownLogin} className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="profile-role-select"
                  className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-2.5"
                >
                  <span className="h-8 w-8 rounded-full bg-[#141414] text-white dark:bg-zinc-800 dark:text-zinc-100 inline-flex items-center justify-center">
                    <UserCheck className="h-4 w-4" />
                  </span>
                  <span>Profilo Operatore</span>
                </label>
                {selectedProfile && (
                  <Badge
                    key={selectedProfile.id}
                    variant={selectedProfile.role === 'admin' ? 'neutral' : 'blue'}
                    className="animate-badge-pop"
                  >
                    {selectedProfile.role === 'admin' ? (
                      <>
                        <ShieldCheck className="h-3 w-3" />
                        Admin
                      </>
                    ) : (
                      <>
                        <Bike className="h-3 w-3" />
                        Rider {selectedProfile.rider_number ?? ''}
                      </>
                    )}
                  </Badge>
                )}
              </div>

              <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

              <div className="relative">
                <select
                  id="profile-role-select"
                  value={selectedProfileId}
                  onChange={(e) => {
                    setSelectedProfileId(e.target.value);
                    setError(null);
                  }}
                  className="w-full h-12 appearance-none rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-[#f4f4f5] dark:bg-zinc-900 pl-4 pr-10 text-sm font-semibold text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-white/20 focus:bg-white dark:focus:bg-zinc-900 cursor-pointer transition-all"
                >
                  {adminUsers.length > 0 && (
                    <optgroup label="Amministrazione / Cassa">
                      {adminUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          🛡️ {u.name} (Admin)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {riderUsers.length > 0 && (
                    <optgroup label="Rider Consegne">
                      {riderUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          🛵 #{u.rider_number ?? ''} {u.name} (Rider)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown className="h-4 w-4 text-zinc-500 pointer-events-none absolute right-3.5 top-4" />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                className="w-full h-12 rounded-2xl text-sm font-semibold"
                disabled={submitting || !selectedProfile}
              >
                <LogIn className="h-4 w-4" />
                {selectedProfile
                  ? `Accedi come ${selectedProfile.name}`
                  : 'Seleziona un profilo'}
              </Button>
            </form>
          </div>
        </Card>
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        HAM Domicili • Cassa Rider &amp; Riconciliazione Real-Time
      </p>
    </div>
  );
};
