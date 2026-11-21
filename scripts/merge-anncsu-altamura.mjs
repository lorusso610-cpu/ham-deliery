import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STREETS_PATH = path.resolve(__dirname, '../src/data/altamura_streets.json');
const TMP_DIR = '/tmp/anncsu_puglia';
const INDIR_ZIP = path.join(TMP_DIR, 'indir.zip');

const INDIR_URL =
  'https://anncsu.open.agenziaentrate.gov.it/age-inspire/opendata/anncsu/getds.php?INDIR_PUGL';

function roundCoord(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function normalizeKey(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCaseItalian(str) {
  const lowerWords = new Set(['di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'a', 'in', 'su', 'per', 'e', 'ed']);
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      if (idx > 0 && lowerWords.has(word)) return word;
      if (word === 'ii' || word === 'iii' || word === 'iv' || word === 'vi' || word === 'xx' || word === 'xxv') {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function inferTypeFromOdonimo(odonimo) {
  const up = odonimo.toUpperCase();
  if (up.startsWith('PIAZZA ') || up.startsWith('PIAZZALE ') || up.startsWith('LARGO ')) return 'square';
  if (up.startsWith('CLAUSTRO ') || up.startsWith('ARCO ') || up.startsWith('VICO ') || up.startsWith('VICOLO ')) return 'living_street';
  if (up.startsWith('CORSO ') || up.startsWith('VIALE ')) return 'secondary';
  if (up.startsWith('CONTRADA ') || up.startsWith('STRADA ')) return 'unclassified';
  return 'residential';
}

async function ensureIndirZip() {
  try {
    await fs.access(INDIR_ZIP);
  } catch {
    console.log('Download indirizzario ufficiale Puglia ANNCSU...');
    await fs.mkdir(TMP_DIR, { recursive: true });
    execFileSync(
      'curl',
      ['-sS', '--max-time', '120', '-A', 'Mozilla/5.0', '-o', INDIR_ZIP, INDIR_URL],
      { stdio: 'inherit' }
    );
  }
}

async function main() {
  await ensureIndirZip();

  const existingRaw = await fs.readFile(STREETS_PATH, 'utf-8');
  const existingStreets = JSON.parse(existingRaw);

  const streetByKey = new Map();
  for (const s of existingStreets) {
    streetByKey.set(normalizeKey(s.street), {
      ...s,
      housenumbers: s.housenumbers ? { ...s.housenumbers } : {},
    });
  }

  console.log('Estrazione righe Altamura (A225) da INDIR_PUGL...');
  const csvChunk = execFileSync(
    'sh',
    ['-c', `unzip -p "${INDIR_ZIP}" | grep "^A225;"`],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8' }
  );

  const lines = csvChunk.split(/\r?\n/).filter(Boolean);
  console.log(`Righe civici Altamura trovate in ANNCSU: ${lines.length}`);

  const anncsuBuckets = new Map();

  for (const line of lines) {
    // CODICE_COMUNE;CODICE_ISTAT;PROGRESSIVO_NAZIONALE;CODICE_COMUNALE;ODONIMO;LOCALITA';DIZIONE_LINGUA1;DIZIONE_LINGUA2;PROGRESSIVO_ACCESSO;CODICE_COMUNALE_ACCESSO;CIVICO;ESPONENTE;SPECIFICITA;METRICO;PROGRESSIVO_SNC;COORD_X_COMUNE;COORD_Y_COMUNE;QUOTA;METODO
    const cols = line.split(';');
    if (cols.length < 17) continue;

    const odonimo = (cols[4] || '').trim();
    const civico = (cols[10] || '').trim();
    const esponente = (cols[11] || '').trim();
    const metrico = (cols[13] || '').trim();
    const coordXStr = (cols[15] || '').trim().replace(',', '.');
    const coordYStr = (cols[16] || '').trim().replace(',', '.');

    if (!odonimo) continue;
    const lng = Number(coordXStr);
    const lat = Number(coordYStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Verifica che le coordinate siano dentro il territorio di Altamura
    if (lat < 40.70 || lat > 40.95 || lng < 16.40 || lng > 16.70) continue;

    let label = '';
    if (civico) {
      label = esponente ? `${civico}${esponente}` : civico;
    } else if (metrico) {
      label = `km ${metrico}`;
    } else {
      continue;
    }

    const key = normalizeKey(odonimo);
    if (!anncsuBuckets.has(key)) {
      anncsuBuckets.set(key, {
        odonimo,
        entries: [],
      });
    }
    anncsuBuckets.get(key).entries.push({
      label,
      lat: roundCoord(lat),
      lng: roundCoord(lng),
    });
  }

  let matchedOsmStreets = 0;
  let addedAnncsuStreets = 0;
  let totalCivici = 0;

  for (const [key, bucket] of anncsuBuckets.entries()) {
    let target = streetByKey.get(key);

    // Calcola centroide e bounds dai civici ufficiali
    let latSum = 0;
    let lngSum = 0;
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;

    for (const e of bucket.entries) {
      latSum += e.lat;
      lngSum += e.lng;
      if (e.lat < minLat) minLat = e.lat;
      if (e.lng < minLng) minLng = e.lng;
      if (e.lat > maxLat) maxLat = e.lat;
      if (e.lng > maxLng) maxLng = e.lng;
    }

    if (target) {
      matchedOsmStreets += 1;
    } else {
      addedAnncsuStreets += 1;
      target = {
        street: toTitleCaseItalian(bucket.odonimo),
        type: inferTypeFromOdonimo(bucket.odonimo),
        lat: roundCoord(latSum / bucket.entries.length),
        lng: roundCoord(lngSum / bucket.entries.length),
        bounds: [
          [roundCoord(minLat), roundCoord(minLng)],
          [roundCoord(maxLat), roundCoord(maxLng)],
        ],
        housenumbers: {},
      };
      streetByKey.set(key, target);
    }

    for (const e of bucket.entries) {
      if (!target.housenumbers[e.label]) {
        target.housenumbers[e.label] = [e.lat, e.lng];
        totalCivici += 1;
      }
    }
  }

  const finalList = Array.from(streetByKey.values()).map((s) => {
    const hasNums = s.housenumbers && Object.keys(s.housenumbers).length > 0;
    if (!hasNums) {
      const { housenumbers: _, ...rest } = s;
      return rest;
    }
    return s;
  });

  finalList.sort((a, b) => a.street.localeCompare(b.street, 'it'));

  await fs.writeFile(STREETS_PATH, JSON.stringify(finalList), 'utf-8');
  const stat = await fs.stat(STREETS_PATH);

  console.log('Merge ANNCSU + OSM completato!');
  console.log(`- Vie/piazze/claustri totali: ${finalList.length}`);
  console.log(`- Vie OSM arricchite con civici ANNCSU: ${matchedOsmStreets}`);
  console.log(`- Nuove vie/contrade/archi ANNCSU aggiunte: ${addedAnncsuStreets}`);
  console.log(`- Numeri civici ufficiali indicizzati: ${totalCivici}`);
  console.log(`- Dimensione finale file: ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Errore merge ANNCSU:', err);
  process.exit(1);
});
