import React, { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Hash, MapPin, Navigation } from 'lucide-react';
import streetsRaw from '@/data/altamura_streets.json';
import { Input, cn } from '@/components/ui/primitives';

export interface AltamuraStreetEntry {
  street: string;
  type: string;
  lat: number;
  lng: number;
  bounds: [[number, number], [number, number]];
  housenumbers?: Record<string, [number, number]>;
}

const STREETS_DATA = streetsRaw as AltamuraStreetEntry[];

export function findCivicoCoords(
  street: AltamuraStreetEntry,
  rawCivico: string
): [number, number] | null {
  const clean = rawCivico.trim().toUpperCase();
  if (!clean || !street.housenumbers) return null;
  if (street.housenumbers[clean]) return street.housenumbers[clean];
  for (const [k, coords] of Object.entries(street.housenumbers)) {
    if (k.toUpperCase() === clean) return coords;
  }
  return null;
}

export function getSortedCivici(
  street: AltamuraStreetEntry | null,
  filterQuery: string,
  limit = 16
): string[] {
  if (!street?.housenumbers) return [];
  const keys = Object.keys(street.housenumbers).sort((a, b) =>
    a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' })
  );
  const q = filterQuery.trim().toUpperCase();
  if (!q) return keys.slice(0, limit);
  const starts = keys.filter((k) => k.toUpperCase().startsWith(q));
  const contains = keys.filter(
    (k) => !k.toUpperCase().startsWith(q) && k.toUpperCase().includes(q)
  );
  return [...starts, ...contains].slice(0, limit);
}

export interface ResolvedAltamuraAddress {
  fullAddress: string;
  street: string;
  housenumber: string;
  lat: number | null;
  lng: number | null;
  source: 'local_street' | 'local_civico' | 'nominatim' | 'manual';
}

const globalFuse = new Fuse(STREETS_DATA, {
  keys: ['street'],
  threshold: 0.36,
  ignoreLocation: true,
  minMatchCharLength: 2,
});

/**
 * Risolve una stringa indirizzo (es. da comando vocale "Via Bari 42" o "Via Roma 15")
 * cercando nello stradario locale di Altamura e nei civici ANNCSU.
 */
export function resolveAddressFromText(rawText: string): ResolvedAltamuraAddress {
  const cleaned = rawText
    .trim()
    .replace(/,\s*altamura.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return {
      fullAddress: '',
      street: '',
      housenumber: '',
      lat: null,
      lng: null,
      source: 'manual',
    };
  }

  // Estrae eventuale numero civico finale (es. "Via Bari 42", "Via Roma 15/A", "Piazza Duomo n 8")
  const civicoMatch = cleaned.match(/^(.*?)(?:\s+(?:n\.?|num\.?|civico)?\s*(\d+[a-zA-Z]?(?:\/[a-zA-Z0-9]+)?))$/i);
  const rawStreetPart = (civicoMatch ? civicoMatch[1] : cleaned).trim();
  const extractedCivico = (civicoMatch ? civicoMatch[2] : '').trim().toUpperCase();

  const normalizedStreet = rawStreetPart
    .replace(/^v\.\s*/i, 'Via ')
    .replace(/\bf\.sco\b/gi, 'Francesco')
    .replace(/\bc\.so\b/gi, 'Corso')
    .replace(/\bp\.zza\b/gi, 'Piazza');

  const hits = globalFuse.search(normalizedStreet);
  const best = hits[0]?.item;

  if (best) {
    const localCivicoCoords = extractedCivico
      ? findCivicoCoords(best, extractedCivico)
      : null;
    const coords: [number, number] = localCivicoCoords ?? [best.lat, best.lng];
    const fullAddress = extractedCivico
      ? `${best.street} ${extractedCivico}, Altamura`
      : `${best.street}, Altamura`;

    return {
      fullAddress,
      street: best.street,
      housenumber: extractedCivico,
      lat: coords[0],
      lng: coords[1],
      source: localCivicoCoords ? 'local_civico' : 'local_street',
    };
  }

  const fallbackFull = extractedCivico
    ? `${rawStreetPart} ${extractedCivico}`
    : rawStreetPart;

  return {
    fullAddress: fallbackFull,
    street: rawStreetPart,
    housenumber: extractedCivico,
    lat: null,
    lng: null,
    source: 'manual',
  };
}

interface AltamuraAddressInputProps {
  value: string;
  onChangeAddress: (resolved: ResolvedAltamuraAddress) => void;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
  placeholder?: string;
  error?: string;
}

const TYPE_LABELS_IT: Record<string, string> = {
  residential: 'Via',
  pedestrian: 'Area Pedonale',
  living_street: 'Claustro / ZTL',
  tertiary: 'Strada',
  secondary: 'Corso / Arteria',
  primary: 'Statale / Principale',
  service: 'Accesso / Vicolo',
  unclassified: 'Contrada / Strada',
  square: 'Piazza',
  neighbourhood: 'Rione / Zona',
};

export const AltamuraAddressInput: React.FC<AltamuraAddressInputProps> = ({
  value,
  onChangeAddress,
  inputRef,
  placeholder = 'Cerca via, claustro o piazza di Altamura...',
  error,
}) => {
  const [query, setQuery] = useState(value);
  const [civico, setCivico] = useState('');
  const [selectedStreet, setSelectedStreet] = useState<AltamuraStreetEntry | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [civicoDropdownOpen, setCivicoDropdownOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [activeCoords, setActiveCoords] = useState<[number, number] | null>(null);
  const [coordSourceLabel, setCoordSourceLabel] = useState<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const civicoInputRef = useRef<HTMLInputElement | null>(null);

  // Sincronizza reset esterno o precompilazione vocale esterna
  useEffect(() => {
    if (!value) {
      setQuery('');
      setCivico('');
      setSelectedStreet(null);
      setActiveCoords(null);
      setCoordSourceLabel('');
      return;
    }

    const currentFull = selectedStreet
      ? civico.trim()
        ? `${selectedStreet.street} ${civico.trim()}, Altamura`
        : `${selectedStreet.street}, Altamura`
      : civico.trim()
      ? `${query.trim()} ${civico.trim()}`
      : query.trim();

    if (value.trim() !== currentFull.trim()) {
      const resolved = resolveAddressFromText(value);
      setQuery(resolved.street);
      setCivico(resolved.housenumber);
      if (resolved.source === 'local_civico' || resolved.source === 'local_street') {
        const entry =
          STREETS_DATA.find(
            (s) => s.street.toLowerCase() === resolved.street.toLowerCase()
          ) ?? null;
        setSelectedStreet(entry);
        if (resolved.lat !== null && resolved.lng !== null) {
          setActiveCoords([resolved.lat, resolved.lng]);
          setCoordSourceLabel(
            resolved.source === 'local_civico'
              ? `Civico ${resolved.housenumber} ANNCSU`
              : 'Centro via'
          );
        }
      } else {
        setSelectedStreet(null);
        setActiveCoords(null);
        setCoordSourceLabel('');
      }
    }
  }, [value]);

  const civicoSuggestions = useMemo(
    () => getSortedCivici(selectedStreet, civico, 24),
    [selectedStreet, civico]
  );

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

  // Ricerca fuzzy locale istantanea (0 ms, nessuna chiamata di rete)
  const suggestions = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    // Normalizza abbreviazioni comuni es. "V. " -> "Via ", "F.sco" -> "Francesco"
    const normalized = trimmed
      .replace(/^v\.\s*/i, 'Via ')
      .replace(/\bf\.sco\b/gi, 'Francesco')
      .replace(/\bc\.so\b/gi, 'Corso')
      .replace(/\bp\.zza\b/gi, 'Piazza');

    return fuse
      .search(normalized)
      .slice(0, 8)
      .map((r) => r.item);
  }, [fuse, query]);

  // Chiudi dropdown al click esterno
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setCivicoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Fallback silenzioso su Nominatim ristretto ad Altamura se il civico non è nel JSON locale
  useEffect(() => {
    const cleanCivico = civico.trim();
    if (!selectedStreet) return;

    if (!cleanCivico) {
      setActiveCoords([selectedStreet.lat, selectedStreet.lng]);
      setCoordSourceLabel('Centro via');
      return;
    }

    const localMatch = findCivicoCoords(selectedStreet, cleanCivico);
    if (localMatch) {
      setActiveCoords(localMatch);
      setCoordSourceLabel(`Civico ${cleanCivico} ANNCSU`);
      onChangeAddress({
        fullAddress: `${selectedStreet.street} ${cleanCivico}, Altamura`,
        street: selectedStreet.street,
        housenumber: cleanCivico,
        lat: localMatch[0],
        lng: localMatch[1],
        source: 'local_civico',
      });
      return;
    }

    // Imposta subito le coordinate della via mentre tenta il raffinamento silenzioso
    const fullAddr = `${selectedStreet.street} ${cleanCivico}, Altamura`;
    setActiveCoords([selectedStreet.lat, selectedStreet.lng]);
    setCoordSourceLabel('Centro via');
    onChangeAddress({
      fullAddress: fullAddr,
      street: selectedStreet.street,
      housenumber: cleanCivico,
      lat: selectedStreet.lat,
      lng: selectedStreet.lng,
      source: 'local_street',
    });

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = encodeURIComponent(`${selectedStreet.street} ${cleanCivico}, Altamura, BA`);
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=16.48,40.78,16.62,40.87&q=${q}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const json = (await res.json()) as Array<{ lat: string; lon: string }>;
        if (json[0]) {
          const nLat = Number(json[0].lat);
          const nLng = Number(json[0].lon);
          if (Number.isFinite(nLat) && Number.isFinite(nLng)) {
            setActiveCoords([nLat, nLng]);
            setCoordSourceLabel(`Civico ${cleanCivico} Nominatim`);
            onChangeAddress({
              fullAddress: fullAddr,
              street: selectedStreet.street,
              housenumber: cleanCivico,
              lat: nLat,
              lng: nLng,
              source: 'nominatim',
            });
          }
        }
      } catch {
        // Fallback silenzioso: mantiene le coordinate locali della via
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [civico, selectedStreet, onChangeAddress]);

  const handleSelectStreet = (entry: AltamuraStreetEntry) => {
    setSelectedStreet(entry);
    setQuery(entry.street);
    setDropdownOpen(false);
    setHighlightedIdx(0);

    const cleanCivico = civico.trim();
    const localMatch = cleanCivico ? findCivicoCoords(entry, cleanCivico) : null;
    const coords: [number, number] = localMatch ?? [entry.lat, entry.lng];
    setActiveCoords(coords);
    setCoordSourceLabel(localMatch ? `Civico ${cleanCivico} ANNCSU` : 'Centro via');

    const fullAddress = cleanCivico
      ? `${entry.street} ${cleanCivico}, Altamura`
      : `${entry.street}, Altamura`;

    onChangeAddress({
      fullAddress,
      street: entry.street,
      housenumber: cleanCivico,
      lat: coords[0],
      lng: coords[1],
      source: localMatch ? 'local_civico' : 'local_street',
    });

    setTimeout(() => {
      civicoInputRef.current?.focus();
      if (entry.housenumbers && Object.keys(entry.housenumbers).length > 0) {
        setCivicoDropdownOpen(true);
      }
    }, 0);
  };

  const handleStreetTextChange = (nextText: string) => {
    setQuery(nextText);
    setSelectedStreet(null);
    setDropdownOpen(nextText.trim().length >= 2);
    setHighlightedIdx(0);

    const fullAddress = civico.trim() ? `${nextText.trim()} ${civico.trim()}` : nextText;
    onChangeAddress({
      fullAddress,
      street: nextText,
      housenumber: civico.trim(),
      lat: null,
      lng: null,
      source: 'manual',
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelectStreet(suggestions[highlightedIdx]);
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <MapPin className="h-4 w-4 text-zinc-500 absolute left-3.5 top-3.5" />
          <Input
            ref={(el) => {
              localInputRef.current = el;
              if (inputRef) inputRef.current = el;
            }}
            value={query}
            onChange={(e) => handleStreetTextChange(e.target.value)}
            onFocus={() => {
              if (query.trim().length >= 2 && !selectedStreet) setDropdownOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="pl-10 h-12 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-[#f8f8fa] dark:bg-zinc-900/90 font-medium text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 shadow-sm"
            autoComplete="off"
          />
        </div>

        <div className="relative w-24 shrink-0">
          <Hash className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-4" />
          <Input
            ref={civicoInputRef}
            value={civico}
            onFocus={() => {
              if (selectedStreet && civicoSuggestions.length > 0) {
                setCivicoDropdownOpen(true);
              }
            }}
            onChange={(e) => {
              const nextCiv = e.target.value;
              setCivico(nextCiv);
              setCivicoDropdownOpen(Boolean(selectedStreet));
              if (!selectedStreet) {
                const full = nextCiv.trim() ? `${query.trim()} ${nextCiv.trim()}` : query;
                onChangeAddress({
                  fullAddress: full,
                  street: query,
                  housenumber: nextCiv.trim(),
                  lat: null,
                  lng: null,
                  source: 'manual',
                });
              }
            }}
            placeholder="Civ."
            className="pl-8 h-12 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-[#f8f8fa] dark:bg-zinc-900/90 font-mono text-sm text-zinc-900 dark:text-zinc-50 shadow-sm"
            aria-label="Numero civico"
          />

          {civicoDropdownOpen && civicoSuggestions.length > 0 && (
            <div className="absolute right-0 top-11 w-32 z-40 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141417] shadow-2xl max-h-52 overflow-y-auto animate-dropdown-expand">
              {civicoSuggestions.map((num) => (
                <button
                  key={num}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setCivico(num);
                    setCivicoDropdownOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-left font-mono text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-between transition-colors duration-75"
                >
                  <span>n° {num}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedStreet && activeCoords && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
          <Navigation className="h-3 w-3" />
          <span>
            {coordSourceLabel} ({activeCoords[0].toFixed(5)}, {activeCoords[1].toFixed(5)})
          </span>
        </div>
      )}

      {error && <p className="text-xs text-rose-500 mt-1 animate-validation-shake">{error}</p>}

      {dropdownOpen && suggestions.length > 0 && (
        <div className="absolute left-0 right-24 top-11 z-40 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141417] shadow-2xl overflow-hidden max-h-64 overflow-y-auto animate-dropdown-expand">
          {suggestions.map((item, idx) => {
            const active = idx === highlightedIdx;
            const typeLabel = TYPE_LABELS_IT[item.type] ?? item.type;
            return (
              <button
                key={`${item.street}-${idx}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectStreet(item);
                }}
                onMouseEnter={() => setHighlightedIdx(idx)}
                className={cn(
                  'w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 text-xs transition-colors duration-75',
                  active
                    ? 'bg-[#141414] text-white dark:bg-white dark:text-[#141414]'
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
              >
                <span className="font-semibold truncate">{item.street}</span>
                <span
                  className={cn(
                    'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-full shrink-0',
                    active
                      ? 'bg-white/20 text-white dark:bg-zinc-900/15 dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  )}
                >
                  {typeLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
