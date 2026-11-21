import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Fuse from 'fuse.js';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Rectangle,
  useMap,
} from 'react-leaflet';
import {
  ArrowRightLeft,
  CheckCircle2,
  Hash,
  MapPin,
  Plus,
  Route,
  Search,
  Store,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import streetsRaw from '@/data/altamura_streets.json';
import {
  formatOrderMovedOrigin,
  getOrderRound,
  getPlatformTheme,
  ORDER_STATUS_LABELS,
  type Order,
} from '@/types/database';
import {
  ALTAMURA_MAX_BOUNDS,
  HAM_ALTAMURA_COORDS,
  calculateOptimalPointsRoute,
  calculateOptimalRoute,
  type OptimalRouteResult,
} from '@/lib/routing';
import { formatEuro } from '@/lib/currency';
import { useAppStore } from '@/lib/store';
import {
  AltamuraAddressInput,
  findCivicoCoords,
  getSortedCivici,
  type AltamuraStreetEntry,
} from '@/components/AltamuraAddressInput';
import { Badge, Button, Card, Input, Modal, cn } from '@/components/ui/primitives';

const STREETS_DATA = streetsRaw as AltamuraStreetEntry[];

// ---------------------------------------------------------------------------
// IndexedDB Tile Cache per OpenStreetMap (funziona offline senza riscaricare)
// ---------------------------------------------------------------------------
const IDB_NAME = 'ham_altamura_tiles_v1';
const IDB_STORE = 'tiles';

function openTileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedTileBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openTileDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedTileBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openTileDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore quota errors
  }
}

const CachedOsmTileLayer: React.FC = () => {
  const map = useMap();

  useEffect(() => {
    const OfflineLayer = L.TileLayer.extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        const url = this.getTileUrl(coords);
        const cacheKey = `${coords.z}/${coords.x}/${coords.y}`;
        let objectUrl: string | null = null;

        const revoke = () => {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
        };

        tile.onload = () => {
          revoke();
          done(undefined, tile);
        };
        tile.onerror = () => {
          revoke();
          done(new Error('Tile load failed'), tile);
        };

        void (async () => {
          const cached = await getCachedTileBlob(cacheKey);
          if (cached) {
            objectUrl = URL.createObjectURL(cached);
            tile.src = objectUrl;
            return;
          }

          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            void setCachedTileBlob(cacheKey, blob);
            objectUrl = URL.createObjectURL(blob);
            tile.src = objectUrl;
          } catch {
            tile.src = url;
          }
        })();

        return tile;
      },
    });

    const layer = new (OfflineLayer as unknown as new (
      url: string,
      options: L.TileLayerOptions
    ) => L.TileLayer)('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      minZoom: 13,
      maxZoom: 19,
    });

    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
};

// Icone Leaflet con puntatore di precisione a spillo
const hamHqIcon = L.divIcon({
  className: 'ham-hq-pin',
  html: `
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.5));">
      <div style="background:#f59e0b;color:#09090b;font-weight:900;font-size:12px;padding:5px 12px;border-radius:12px;border:2px solid #09090b;white-space:nowrap;display:flex;align-items:center;gap:5px;box-shadow:0 3px 8px rgba(0,0,0,0.3);">
        <span style="font-size:14px;">🍔</span>
        <span>HAM • Via Golgota 86</span>
      </div>
      <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid #f59e0b;margin-top:-2px;"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#ef4444;border:2.5px solid #ffffff;box-shadow:0 0 0 4px rgba(239,68,68,0.45);margin-top:-5px;"></div>
    </div>
  `,
  iconSize: [170, 52],
  iconAnchor: [85, 48], // Il punto rosso si posiziona ESATTAMENTE sulle coordinate [lat, lng]
});

function createPinIcon(label: string, color: string, textColor = '#09090b') {
  return L.divIcon({
    className: 'ham-stop-pin',
    html: `<div style="background:${color};color:${textColor};font-weight:900;font-size:11px;min-width:28px;height:28px;padding:0 5px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #09090b;box-shadow:0 4px 10px rgba(0,0,0,0.35);">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export interface SelectedMapStop {
  key: string;
  label: string;
  street: string;
  housenumber: string;
  type: string;
  lat: number;
  lng: number;
  bounds: [[number, number], [number, number]];
}

const MapViewportController: React.FC<{
  route: OptimalRouteResult | null;
  selectedStops: SelectedMapStop[];
  hamCoords: [number, number];
  recenterTrigger: number;
}> = ({ route, selectedStops, hamCoords, recenterTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (route && route.polyline.length >= 2) {
      map.fitBounds(L.latLngBounds(route.polyline).pad(0.15), { maxZoom: 17 });
      return;
    }
    if (selectedStops.length > 0) {
      const pts: [number, number][] = selectedStops.map((s) => [s.lat, s.lng]);
      pts.push(hamCoords);
      map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 17 });
      return;
    }
    map.flyTo(hamCoords, 17, { animate: true });
  }, [map, route, selectedStops, hamCoords, recenterTrigger]);

  return null;
};

interface AltamuraMapProps {
  orders: Order[];
  hamCoords?: [number, number];
  heightClass?: string;
  autoCalculateRoute?: boolean;
  title?: string;
  enableStreetSearch?: boolean;
  allowOrderManagement?: boolean;
  onSelectCheckpointOrder?: (order: Order | null) => void;
  onMoveOrder?: (order: Order) => void;
  onCompleteOrder?: (order: Order) => void;
}

export const AltamuraMap: React.FC<AltamuraMapProps> = ({
  orders,
  hamCoords = HAM_ALTAMURA_COORDS,
  heightClass = 'h-[380px]',
  autoCalculateRoute = false,
  title = 'Mappa Confinata Altamura (BA)',
  enableStreetSearch = true,
  allowOrderManagement = false,
  onSelectCheckpointOrder,
  onMoveOrder,
  onCompleteOrder,
}) => {
  const { riders, deleteOrCancelOrder, reassignOrder, updateOrderStatus } = useAppStore();
  const [route, setRoute] = useState<OptimalRouteResult | null>(null);
  const [routeLabel, setRouteLabel] = useState<'orders' | 'streets' | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Order | null>(null);

  const handleSelectCheckpoint = (order: Order | null) => {
    setSelectedCheckpoint(order);
    onSelectCheckpointOrder?.(order);
  };

  // Gestione posizione dinamica Sede HAM
  const [currentHamAddress, setCurrentHamAddress] = useState<string>(() => {
    try {
      return localStorage.getItem('ham_custom_address') || 'Via Golgota 86, Altamura';
    } catch {
      return 'Via Golgota 86, Altamura';
    }
  });

  const [currentHamCoords, setCurrentHamCoords] = useState<[number, number]>(() => {
    try {
      const saved = localStorage.getItem('ham_custom_coords');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.length === 2 &&
          Number.isFinite(parsed[0]) &&
          Number.isFinite(parsed[1])
        ) {
          return [parsed[0], parsed[1]];
        }
      }
    } catch {
      // fallback
    }
    return hamCoords;
  });

  const [isEditHamOpen, setIsEditHamOpen] = useState(false);
  const [newHamAddress, setNewHamAddress] = useState('');
  const [newHamCoords, setNewHamCoords] = useState<[number, number] | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Ricerca e selezione multipla vie + civici
  const [streetQuery, setStreetQuery] = useState('');
  const [draftStreet, setDraftStreet] = useState<AltamuraStreetEntry | null>(null);
  const [draftCivico, setDraftCivico] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [civicoDropdownOpen, setCivicoDropdownOpen] = useState(false);
  const [selectedStops, setSelectedStops] = useState<SelectedMapStop[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const civicoInputRef = useRef<HTMLInputElement | null>(null);

  const fuse = useMemo(
    () =>
      new Fuse(STREETS_DATA, {
        keys: ['street'],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    []
  );

  const streetSuggestions = useMemo(() => {
    const trimmed = streetQuery.trim();
    if (!trimmed) return [];
    const normalized = trimmed
      .replace(/^v\.\s*/i, 'Via ')
      .replace(/\bf\.sco\b/gi, 'Francesco')
      .replace(/\bc\.so\b/gi, 'Corso')
      .replace(/\bp\.zza\b/gi, 'Piazza');
    return fuse
      .search(normalized)
      .slice(0, 10)
      .map((r) => r.item);
  }, [fuse, streetQuery]);

  const civicoSuggestions = useMemo(
    () => getSortedCivici(draftStreet, draftCivico, 30),
    [draftStreet, draftCivico]
  );

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setCivicoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const addStopToMap = (entry: AltamuraStreetEntry, rawCivico = '') => {
    const cleanCiv = rawCivico.trim();
    const civCoords = cleanCiv ? findCivicoCoords(entry, cleanCiv) : null;
    const lat = civCoords ? civCoords[0] : entry.lat;
    const lng = civCoords ? civCoords[1] : entry.lng;
    const label = cleanCiv ? `${entry.street} ${cleanCiv}` : entry.street;
    const key = `${entry.street}::${cleanCiv.toUpperCase()}`;

    setSelectedStops((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [
        ...prev,
        {
          key,
          label,
          street: entry.street,
          housenumber: cleanCiv,
          type: entry.type,
          lat,
          lng,
          bounds: entry.bounds,
        },
      ];
    });
    setStreetQuery('');
    setDraftStreet(null);
    setDraftCivico('');
    setDropdownOpen(false);
    setCivicoDropdownOpen(false);
  };

  const removeStopFromMap = (key: string) => {
    setSelectedStops((prev) => prev.filter((s) => s.key !== key));
  };

  const activeGeocodedOrders = orders.filter(
    (o) =>
      o.status !== 'delivered' &&
      o.status !== 'cancelled' &&
      typeof o.lat === 'number' &&
      typeof o.lng === 'number'
  );

  const handleComputeOrdersRoute = async () => {
    setCalculating(true);
    const res = await calculateOptimalRoute(currentHamCoords, orders);
    setRoute(res);
    setRouteLabel('orders');
    setCalculating(false);
  };

  const handleComputeSelectedStreetsRoute = async () => {
    if (selectedStops.length === 0) return;
    setCalculating(true);
    const res = await calculateOptimalPointsRoute(
      currentHamCoords,
      selectedStops.map((s) => ({
        id: `stop:${s.key}`,
        label: s.label,
        lat: s.lat,
        lng: s.lng,
      }))
    );
    setRoute(res);
    setRouteLabel('streets');
    setCalculating(false);
  };

  useEffect(() => {
    if (autoCalculateRoute && activeGeocodedOrders.length > 0 && selectedStops.length === 0) {
      void handleComputeOrdersRoute();
    } else if (activeGeocodedOrders.length === 0 && routeLabel === 'orders') {
      setRoute(null);
      setRouteLabel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCalculateRoute, orders.map((o) => `${o.id}:${o.status}:${o.lat}`).join('|')]);

  const nonCancelledOrders = orders.filter((o) => o.status !== 'cancelled');

  return (
    <Card className="overflow-hidden border-zinc-200 dark:border-zinc-800">
      {/* Header mappa */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/70 dark:bg-zinc-900">
        <div className="flex items-center gap-2 min-w-0">
          <Store className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-50 truncate">
            {title}
          </span>
          <Badge variant="neutral">{activeGeocodedOrders.length} attive</Badge>
          {selectedStops.length > 0 && (
            <Badge variant="purple">{selectedStops.length} punti selezionati</Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tasto Sede HAM: centra istantaneamente su Via Golgota 86 */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex items-center gap-1.5 border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 font-extrabold h-8 text-xs shrink-0 shadow-sm"
            onClick={() => {
              setCurrentHamAddress('Via Golgota 86, Altamura');
              setCurrentHamCoords(HAM_ALTAMURA_COORDS);
              try {
                localStorage.removeItem('ham_custom_coords');
                localStorage.removeItem('ham_custom_address');
              } catch {
                // ignore
              }
              setRecenterTrigger((prev) => prev + 1);
            }}
            title="Centra la mappa sul punto esatto di HAM (Via Golgota 86)"
          >
            <Store className="h-3.5 w-3.5 text-amber-500" />
            <span>🎯 Sede: Via Golgota 86</span>
          </Button>

          {route && (
            <Badge variant="green" className="flex items-center gap-1 font-bold">
              <Zap className="h-3 w-3 text-emerald-400" />
              100% Offline • {route.totalDistanceKm.toFixed(2).replace('.', ',')} km • ~{route.estimatedMinutes} min
            </Badge>
          )}

          {selectedStops.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={calculating}
              onClick={() => void handleComputeSelectedStreetsRoute()}
            >
              <Route className="h-3.5 w-3.5 text-violet-500" />
              Percorso Vie ({selectedStops.length})
            </Button>
          )}

          {activeGeocodedOrders.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={calculating}
              onClick={() => void handleComputeOrdersRoute()}
            >
              <Route className="h-3.5 w-3.5" />
              {calculating ? 'Calcolo...' : 'Percorso Consegne'}
            </Button>
          )}
        </div>
      </div>

      {/* Sequenza Tappe Ottimale Calcolata (A* + TSP su Grafo Stradale Locale) */}
      {route && route.orderedStops.length > 0 && (
        <div className="px-4 py-2 border-b border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/10 flex items-center gap-2 overflow-x-auto text-xs">
          <span className="font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center gap-1 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Giro Ottimale ({route.orderedStops.length} tappe):
          </span>
          <div className="flex items-center gap-1.5 shrink-0 py-0.5">
            <span className="font-bold text-amber-700 dark:text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-lg border border-amber-500/30">
              HAM (Partenza)
            </span>
            {route.orderedStops.map((stop) => (
              <React.Fragment key={stop.id}>
                <span className="text-zinc-400 font-bold">➔</span>
                <span className="font-bold px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-500/30 text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 shadow-sm">
                  <span className="h-4 w-4 rounded-full bg-emerald-600 text-white text-[10px] flex items-center justify-center font-extrabold shrink-0">
                    {stop.stopNumber}
                  </span>
                  <span className="truncate max-w-[150px]">{stop.label}</span>
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Barra Ricerca & Selezione Multipla Vie + Civici sulla Mappa */}
      {enableStreetSearch && (
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 space-y-2.5">
          <div ref={searchBoxRef} className="relative">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-3" />
                <Input
                  value={streetQuery}
                  onChange={(e) => {
                    setStreetQuery(e.target.value);
                    setDraftStreet(null);
                    setDropdownOpen(e.target.value.trim().length >= 2);
                  }}
                  onFocus={() => {
                    if (streetQuery.trim().length >= 2 && !draftStreet) setDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && streetSuggestions.length > 0) {
                      e.preventDefault();
                      const chosen = streetSuggestions[0];
                      setDraftStreet(chosen);
                      setStreetQuery(chosen.street);
                      setDropdownOpen(false);
                      setTimeout(() => {
                        civicoInputRef.current?.focus();
                        setCivicoDropdownOpen(true);
                      }, 0);
                    } else if (e.key === 'Escape') {
                      setDropdownOpen(false);
                    }
                  }}
                  placeholder="Cerca via di Altamura (es. Via Bari, Claustro...)"
                  className="pl-9"
                />
              </div>

              {/* Input Civico con autocomplete ANNCSU */}
              <div className="relative w-28 shrink-0">
                <Hash className="h-3.5 w-3.5 text-zinc-400 absolute left-2.5 top-3" />
                <Input
                  ref={civicoInputRef}
                  value={draftCivico}
                  disabled={!draftStreet}
                  onFocus={() => {
                    if (draftStreet && civicoSuggestions.length > 0) {
                      setCivicoDropdownOpen(true);
                    }
                  }}
                  onChange={(e) => {
                    setDraftCivico(e.target.value);
                    if (draftStreet) setCivicoDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draftStreet) {
                      e.preventDefault();
                      addStopToMap(draftStreet, draftCivico);
                    }
                  }}
                  placeholder="Civ."
                  className="pl-7 font-mono text-sm disabled:opacity-50"
                />
                {civicoDropdownOpen && civicoSuggestions.length > 0 && (
                  <div className="absolute right-0 top-11 w-32 z-[1001] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl max-h-52 overflow-y-auto">
                    {civicoSuggestions.map((num) => (
                      <button
                        key={num}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (draftStreet) {
                            addStopToMap(draftStreet, num);
                          }
                        }}
                        className="w-full px-3 py-1.5 text-left font-mono text-xs font-semibold hover:bg-amber-500/15 text-zinc-800 dark:text-zinc-200"
                      >
                        n° {num}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {draftStreet && (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => addStopToMap(draftStreet, draftCivico)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Aggiungi
                </Button>
              )}

              {selectedStops.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedStops([]);
                    if (routeLabel === 'streets') {
                      setRoute(null);
                      setRouteLabel(null);
                    }
                  }}
                >
                  Pulisci ({selectedStops.length})
                </Button>
              )}
            </div>

            {dropdownOpen && streetSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-11 z-[1000] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl max-h-60 overflow-y-auto">
                {streetSuggestions.map((item, idx) => {
                  const civCount = item.housenumbers ? Object.keys(item.housenumbers).length : 0;
                  return (
                    <div
                      key={`${item.street}-${idx}`}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-amber-500/10 transition-colors border-b border-zinc-100 dark:border-zinc-800/70 last:border-b-0"
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setDraftStreet(item);
                          setStreetQuery(item.street);
                          setDropdownOpen(false);
                          setTimeout(() => {
                            civicoInputRef.current?.focus();
                            setCivicoDropdownOpen(true);
                          }, 0);
                        }}
                        className="flex-1 text-left font-semibold flex items-center gap-1.5"
                      >
                        <MapPin className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span>{item.street}</span>
                        {civCount > 0 && (
                          <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                            ({civCount} civici)
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addStopToMap(item, '');
                        }}
                        className="rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 px-2 py-1 text-[10px] font-bold shrink-0 transition-colors"
                      >
                        + Intera via
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pillole delle vie/civici selezionati contemporaneamente */}
          {selectedStops.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedStops.map((s, idx) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-800 dark:text-violet-200"
                >
                  <span className="font-mono text-[10px] bg-violet-600 text-white rounded-full px-1.5 py-0.2">
                    V{idx + 1}
                  </span>
                  {s.label}
                  <button
                    type="button"
                    onClick={() => removeStopFromMap(s.key)}
                    className="hover:text-rose-500 transition-colors"
                    aria-label={`Rimuovi ${s.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Canvas Mappa Leaflet confinata su Altamura */}
      <div className={`relative w-full ${heightClass} z-0`}>
        <MapContainer
          center={currentHamCoords}
          zoom={16}
          minZoom={13}
          maxZoom={19}
          maxBounds={ALTAMURA_MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          className="h-full w-full"
          scrollWheelZoom
        >
          <CachedOsmTileLayer />
          <MapViewportController
            route={route}
            selectedStops={selectedStops}
            hamCoords={currentHamCoords}
            recenterTrigger={recenterTrigger}
          />

          {/* Pin fisso sede locale HAM con puntatore di precisione a spillo su Via Golgota 86 */}
          <Marker
            position={currentHamCoords}
            icon={hamHqIcon}
            draggable={true}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                setCurrentHamCoords([pos.lat, pos.lng]);
                try {
                  localStorage.setItem('ham_custom_coords', JSON.stringify([pos.lat, pos.lng]));
                } catch {
                  // ignore
                }
              },
            }}
          >
            <Popup>
              <div className="text-xs font-black text-amber-600 flex items-center gap-1">
                <span>🍔</span> HAM • Sede Locale
              </div>
              <div className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 mt-1">
                Via Golgota 86, Altamura
              </div>
              <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                Punto esatto: [{currentHamCoords[0].toFixed(6)}, {currentHamCoords[1].toFixed(6)}]
              </div>
              <div className="text-[10px] text-emerald-600 font-bold mt-1">
                Punto di partenza e rientro consegne rider
              </div>
              <button
                type="button"
                onClick={() => {
                  setNewHamAddress(currentHamAddress);
                  setNewHamCoords(currentHamCoords);
                  setIsEditHamOpen(true);
                }}
                className="mt-2 text-[11px] font-bold text-amber-600 underline hover:text-amber-700 block"
              >
                Cerca altro indirizzo o trascina il pin
              </button>
            </Popup>
          </Marker>

          {/* Evidenziazione vie/civici selezionati contemporaneamente (visibili quando non c'è percorso vie attivo) */}
          {!route &&
            selectedStops.map((s, idx) => {
              const hasArea =
                !s.housenumber &&
                s.bounds &&
                (Math.abs(s.bounds[0][0] - s.bounds[1][0]) > 0.0001 ||
                  Math.abs(s.bounds[0][1] - s.bounds[1][1]) > 0.0001);
              return (
                <React.Fragment key={s.key}>
                  {hasArea && (
                    <Rectangle
                      bounds={s.bounds}
                      pathOptions={{
                        color: '#8b5cf6',
                        weight: 2,
                        fillColor: '#8b5cf6',
                        fillOpacity: 0.12,
                        dashArray: '4 4',
                      }}
                    />
                  )}
                  <Marker
                    position={[s.lat, s.lng]}
                    icon={createPinIcon(`V${idx + 1}`, '#a78bfa')}
                  >
                    <Popup>
                      <div className="text-xs space-y-1 text-zinc-900">
                        <p className="font-extrabold">{s.label}</p>
                        <p className="text-[11px] text-zinc-600">
                          {s.housenumber ? `Civico ${s.housenumber}` : `Via (${s.type})`} • (
                          {s.lat.toFixed(5)}, {s.lng.toFixed(5)})
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                </React.Fragment>
              );
            })}

          {/* Polilinea percorso ottimale locale (rispetta sensi unici e viabilità Altamura) */}
          {route && route.polyline.length > 1 && (
            <Polyline
              positions={route.polyline}
              pathOptions={{ color: '#f59e0b', weight: 5, opacity: 0.95 }}
            />
          )}

          {/* Marker numerati in ordine ottimale (1°, 2°, 3°...) con colore canale */}
          {route
            ? route.orderedStops.map((stop) => {
                const ch = stop.order ? getPlatformTheme(stop.order.platform) : null;
                const pinColor = ch ? ch.hexColor : '#10b981';
                const pinText = ch?.canonical === 'App' ? '#ffffff' : '#09090b';
                return (
                  <Marker
                    key={stop.id}
                    position={[stop.lat, stop.lng]}
                    icon={createPinIcon(`${stop.stopNumber}°`, pinColor, pinText)}
                    eventHandlers={{
                      click: () => {
                        if (stop.order) {
                          handleSelectCheckpoint(stop.order);
                        }
                      },
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1.5 text-zinc-900 min-w-[180px]">
                        <p className="font-extrabold text-emerald-700">
                          {stop.stopNumber}ª Consegna {stop.order ? `• ${formatEuro(stop.order.order_total)}` : ''}
                        </p>
                        <p className="font-semibold">{stop.order ? stop.order.customer_address : stop.label}</p>
                        {ch && (
                          <div>
                            <Badge variant={ch.badgeVariant}>{ch.fullName}</Badge>
                          </div>
                        )}
                        {allowOrderManagement && stop.order && (
                          <div className="pt-1.5 border-t border-zinc-200 flex flex-col gap-1.5">
                            <select
                              value={stop.order.rider_id}
                              onChange={(e) => {
                                if (e.target.value !== stop.order!.rider_id) {
                                  void reassignOrder(stop.order!.id, e.target.value);
                                }
                              }}
                              className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[11px] font-semibold"
                            >
                              {riders.map((r) => (
                                <option key={r.id} value={r.id}>
                                  Rider: {r.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void deleteOrCancelOrder(stop.order!.id)}
                              className="rounded bg-rose-600 text-white px-2 py-1 text-[11px] font-bold hover:bg-rose-500"
                            >
                              Elimina Consegna
                            </button>
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })
            : activeGeocodedOrders.map((order, idx) => {
                const ch = getPlatformTheme(order.platform);
                const pinText = ch.canonical === 'App' ? '#ffffff' : '#09090b';
                return (
                  <Marker
                    key={order.id}
                    position={[order.lat!, order.lng!]}
                    icon={createPinIcon(String(idx + 1), ch.hexColor, pinText)}
                    eventHandlers={{
                      click: () => {
                        handleSelectCheckpoint(order);
                      },
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1.5 text-zinc-900 min-w-[180px]">
                        <p className="font-extrabold">{formatEuro(order.order_total)}</p>
                        <p className="font-semibold">{order.customer_address}</p>
                        <div>
                          <Badge variant={ch.badgeVariant}>{ch.fullName}</Badge>
                        </div>
                        {allowOrderManagement && (
                          <div className="pt-1.5 border-t border-zinc-200 flex flex-col gap-1.5">
                            <select
                              value={order.rider_id}
                              onChange={(e) => {
                                if (e.target.value !== order.rider_id) {
                                  void reassignOrder(order.id, e.target.value);
                                }
                              }}
                              className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[11px] font-semibold"
                            >
                              {riders.map((r) => (
                                <option key={r.id} value={r.id}>
                                  Rider: {r.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void deleteOrCancelOrder(order.id)}
                              className="rounded bg-rose-600 text-white px-2 py-1 text-[11px] font-bold hover:bg-rose-500"
                            >
                              Elimina Consegna
                            </button>
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
        </MapContainer>
      </div>

      {/* Lista sequenziale tappe ottimali se calcolato */}
      {route && route.orderedStops.length > 0 && (
        <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            {routeLabel === 'streets' ? 'Ordine Vie Ottimale:' : 'Ordine Consegne:'}
          </span>
          {route.orderedStops.map((s) => {
            const ch = s.order ? getPlatformTheme(s.order.platform) : null;
            const isCurrentSelected =
              s.order && selectedCheckpoint && s.order.id === selectedCheckpoint.id;
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => {
                  if (s.order) handleSelectCheckpoint(s.order);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-all active:scale-95',
                  ch
                    ? ch.rowBg
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  isCurrentSelected && 'ring-2 ring-zinc-950 dark:ring-white scale-105'
                )}
                title="Tocca per visualizzare la scheda checkpoint sotto"
              >
                {ch && <span className={cn('h-2 w-2 rounded-full shrink-0', ch.dotClass)} />}
                <strong>{s.stopNumber}°</strong> {s.label.replace(', Altamura', '')}
              </button>
            );
          })}
        </div>
      )}

      {/* Gestione rapida consegne (attive + fatte): Sposta Rider o Elimina */}
      {allowOrderManagement && nonCancelledOrders.length > 0 && (
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Gestione Rapida Consegne ({nonCancelledOrders.length} nel turno — attive e fatte)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
            {nonCancelledOrders.map((order) => {
              const isDelivered = order.status === 'delivered';
              const ch = getPlatformTheme(order.platform);
              const rNum = getOrderRound(order);
              const movedOrigin = formatOrderMovedOrigin(order);
              return (
                <div
                  key={order.id}
                  className={cn(
                    'rounded-xl border p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs',
                    ch.rowBg,
                    order.is_moved && 'ring-1 ring-violet-500/60 border-dashed',
                    isDelivered && 'opacity-85'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="neutral" className="text-[10px] px-1.5 py-0 font-bold">
                        R{rNum}
                      </Badge>
                      <Badge
                        variant={ch.badgeVariant}
                        className="text-[10px] px-1.5 py-0 font-extrabold"
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', ch.dotClass)} />
                        {ch.label}
                      </Badge>
                      {order.is_moved && (
                        <Badge variant="purple" className="text-[10px] px-1.5 py-0 font-bold">
                          Spostata {movedOrigin ? `• ${movedOrigin}` : ''}
                        </Badge>
                      )}
                      <Badge
                        variant={isDelivered ? 'green' : 'amber'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </Badge>
                      <span className="font-mono font-bold">
                        {formatEuro(order.order_total)}
                      </span>
                    </div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
                      {order.customer_address}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1">
                      <ArrowRightLeft className="h-3 w-3 text-zinc-400" />
                      <select
                        value={order.rider_id}
                        onChange={(e) => {
                          if (e.target.value !== order.rider_id) {
                            void reassignOrder(order.id, e.target.value);
                          }
                        }}
                        className="bg-transparent text-[11px] font-semibold focus:outline-none cursor-pointer"
                      >
                        {riders.map((r) => (
                          <option key={r.id} value={r.id} className="bg-white dark:bg-zinc-900">
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!isDelivered && (
                      <button
                        type="button"
                        onClick={() => void updateOrderStatus(order.id, 'delivered')}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white inline-flex items-center gap-1"
                        title="Segna consegnato"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                      </button>
                    )}

                    {confirmDeleteId === order.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void deleteOrCancelOrder(order.id);
                        }}
                        className="rounded-lg bg-rose-600 hover:bg-rose-500 px-2 py-1 text-[11px] font-bold text-white"
                      >
                        Conferma
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(order.id)}
                        className="rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1"
                        title="Elimina consegna"
                      >
                        <Trash2 className="h-3 w-3" />
                        Elimina
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Finestra Descrizione Checkpoint Selezionato (Blocco 4) */}
      {selectedCheckpoint && (
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-[#faf8f5] dark:bg-[#151518] animate-dropdown-expand">
          {(() => {
            const ch = getPlatformTheme(selectedCheckpoint.platform);
            const rNum = getOrderRound(selectedCheckpoint);
            const movedOrigin = formatOrderMovedOrigin(selectedCheckpoint);
            const isDelivered = selectedCheckpoint.status === 'delivered';
            const isPrepaid = selectedCheckpoint.payment_method === 'prepaid_platform';
            const stopIndex = route?.orderedStops.findIndex(
              (s) => s.order?.id === selectedCheckpoint.id
            );
            const stopNumber = stopIndex !== undefined && stopIndex >= 0 ? stopIndex + 1 : null;

            return (
              <div
                className={cn(
                  'rounded-2xl border p-4 space-y-3 shadow-sm',
                  ch.rowBg,
                  selectedCheckpoint.is_moved && 'ring-2 ring-violet-500/60 border-dashed'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stopNumber && (
                      <Badge variant="green" className="font-extrabold uppercase">
                        Tappa {stopNumber}°
                      </Badge>
                    )}
                    <Badge variant="neutral" className="font-bold uppercase">
                      Round {rNum}
                    </Badge>
                    {/* Canale con colore Blu / Giallo / Arancione */}
                    <Badge variant={ch.badgeVariant} className="font-extrabold uppercase">
                      <span className={cn('h-2 w-2 rounded-full shrink-0', ch.dotClass)} />
                      {ch.fullName}
                    </Badge>
                    {/* Badge Spostata */}
                    {selectedCheckpoint.is_moved && (
                      <Badge variant="purple" className="font-bold uppercase">
                        <ArrowRightLeft className="h-3 w-3" />
                        Spostata {movedOrigin ? `• ${movedOrigin}` : ''}
                      </Badge>
                    )}
                    <Badge
                      variant={isDelivered ? 'green' : 'amber'}
                      className="font-bold uppercase"
                    >
                      {ORDER_STATUS_LABELS[selectedCheckpoint.status]}
                    </Badge>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelectCheckpoint(null)}
                    className="h-7 w-7 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:opacity-80"
                    title="Chiudi dettagli checkpoint"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Via completa */}
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                    Via / Indirizzo Consegna
                  </span>
                  <p className="font-extrabold text-base text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5 uppercase tracking-wide">
                    <MapPin className={cn('h-4 w-4 shrink-0', ch.textClass)} />
                    <span>{selectedCheckpoint.customer_address}</span>
                  </p>
                </div>

                {/* Importo da riscuotere o stato "Già pagato" */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/60">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                      Stato Pagamento
                    </span>
                    <p className="text-xs font-bold uppercase tracking-wider mt-0.5">
                      {isPrepaid ? (
                        <span className="text-violet-700 dark:text-violet-400 font-black">
                          ✓ Già Pagato su Piattaforma
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-black">
                          Da Riscuotere: {formatEuro(selectedCheckpoint.order_total)} (
                          {selectedCheckpoint.payment_method === 'cash' ? 'Contanti' : 'POS Mobile'}
                          )
                        </span>
                      )}
                    </p>
                  </div>

                  <span className="font-mono text-xl font-black text-zinc-900 dark:text-zinc-50 tabular-nums">
                    {formatEuro(selectedCheckpoint.order_total)}
                  </span>
                </div>

                {/* Pulsanti Rapidi: Sposta Comanda o Segna Consegnato */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full flex items-center justify-center gap-1.5 font-bold uppercase text-xs rounded-xl"
                    onClick={() => {
                      if (onMoveOrder) {
                        onMoveOrder(selectedCheckpoint);
                      }
                    }}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span>Sposta Comanda</span>
                  </Button>

                  {!isDelivered ? (
                    <Button
                      type="button"
                      variant="success"
                      size="sm"
                      className="w-full flex items-center justify-center gap-1.5 font-bold uppercase text-xs rounded-xl"
                      onClick={() => {
                        if (onCompleteOrder) {
                          onCompleteOrder(selectedCheckpoint);
                        } else {
                          void updateOrderStatus(selectedCheckpoint.id, 'delivered');
                          handleSelectCheckpoint(null);
                        }
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Consegnato</span>
                    </Button>
                  ) : (
                    <div className="flex items-center justify-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      ✓ Completata
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Modal Modifica Sede HAM */}
      <Modal
        open={isEditHamOpen}
        onClose={() => setIsEditHamOpen(false)}
        title="Modifica Posizione Sede HAM"
        subtitle="Imposta o verifica l'indirizzo della sede di partenza delle consegne"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <Store className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs min-w-0">
              <p className="font-extrabold text-zinc-900 dark:text-zinc-100">Posizione Attuale Sede HAM:</p>
              <p className="font-black text-amber-700 dark:text-amber-400 mt-0.5 text-sm truncate">
                {currentHamAddress}
              </p>
              <p className="text-zinc-500 font-mono mt-0.5 text-[11px]">
                Coordinate: [{currentHamCoords[0].toFixed(6)}, {currentHamCoords[1].toFixed(6)}]
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
              Cerca o seleziona nuova sede ad Altamura:
            </label>
            <AltamuraAddressInput
              value={newHamAddress}
              onChangeAddress={(resolved) => {
                setNewHamAddress(resolved.fullAddress);
                if (resolved.lat !== null && resolved.lng !== null) {
                  setNewHamCoords([resolved.lat, resolved.lng]);
                }
              }}
              placeholder="es. Via Golgota 86..."
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 text-xs font-bold"
              onClick={() => {
                setCurrentHamAddress('Via Golgota 86, Altamura');
                setCurrentHamCoords(HAM_ALTAMURA_COORDS);
                try {
                  localStorage.removeItem('ham_custom_coords');
                  localStorage.removeItem('ham_custom_address');
                } catch {
                  // ignore
                }
                setRecenterTrigger((prev) => prev + 1);
                setIsEditHamOpen(false);
              }}
            >
              Ripristina Via Golgota 86
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="flex-1 text-xs font-extrabold"
              disabled={!newHamCoords}
              onClick={() => {
                if (newHamCoords) {
                  setCurrentHamCoords(newHamCoords);
                  setCurrentHamAddress(newHamAddress || 'Via Golgota 86, Altamura');
                  try {
                    localStorage.setItem('ham_custom_coords', JSON.stringify(newHamCoords));
                    localStorage.setItem('ham_custom_address', newHamAddress || 'Via Golgota 86, Altamura');
                  } catch {
                    // ignore
                  }
                  setRecenterTrigger((prev) => prev + 1);
                  setIsEditHamOpen(false);
                }
              }}
            >
              Conferma Posizione
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
