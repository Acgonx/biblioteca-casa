import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { createWorker } from 'tesseract.js';
import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import {
  Barcode,
  Camera,
  Check,
  FolderPlus,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.8-flash';

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function compressImageForGemini(file, maxSize = 768, quality = 0.58) {
  let source;
  let width;
  let height;
  let shouldCloseBitmap = false;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    shouldCloseBitmap = true;
  } else {
    const url = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
    width = source.width;
    height = source.height;
  }

  try {
    if (width > maxSize || height > maxSize) {
      if (width > height) {
        height = Math.max(1, Math.round((height * maxSize) / width));
        width = maxSize;
      } else {
        width = Math.max(1, Math.round((width * maxSize) / height));
        height = maxSize;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    const compressedBytes = Math.round((base64.length * 3) / 4);

    return {
      base64,
      mimeType: 'image/jpeg',
      width,
      height,
      originalBytes: file.size,
      compressedBytes,
    };
  } finally {
    if (shouldCloseBitmap && typeof source?.close === 'function') {
      source.close();
    }
  }
}

async function analyzeShelfWithGemini(base64, mimeType, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
      'Lee todos los libros visibles (lomos o portadas) en la foto. Devuelve JSON con title, author y genre (en español). Si el autor no es legible, usa "Autor desconocido".',
    ],
    config: {
      temperature: 0.1,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            genre: { type: Type.STRING },
          },
          required: ['title', 'author'],
        },
      },
    },
  });

  const rawText = (response.text || '').trim();
  const parsed = JSON.parse(rawText || '[]');
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((b) => b?.title?.trim())
    .map((b) => ({
      title: b.title.trim(),
      author: (b.author || '').trim() || 'Autor desconocido',
      genre: (b.genre || '').trim(),
      notes: '',
    }));
}

function rotateImageToBlob(file, degrees = 90, maxSize = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement('canvas');
      if (degrees === 90 || degrees === 270) {
        canvas.width = height;
        canvas.height = width;
      } else {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -width / 2, -height / 2, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo rotar la imagen'))),
        'image/jpeg',
        0.85
      );
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

const GENRE_MAP = {
  fiction: 'Ficción',
  'literary fiction': 'Ficción literaria',
  'science fiction': 'Ciencia ficción',
  fantasy: 'Fantasía',
  mystery: 'Misterio',
  thriller: 'Suspense',
  horror: 'Terror',
  romance: 'Romance',
  history: 'Historia',
  biography: 'Biografía',
  'biography & autobiography': 'Biografía',
  philosophy: 'Filosofía',
  psychology: 'Psicología',
  science: 'Ciencia',
  poetry: 'Poesía',
  drama: 'Teatro',
  comics: 'Cómic',
  'comics & graphic novels': 'Cómic y novela gráfica',
  art: 'Arte',
  cooking: 'Cocina',
  travel: 'Viajes',
  religion: 'Religión',
  'self-help': 'Autoayuda',
  business: 'Negocios',
  economics: 'Economía',
  education: 'Educación',
  juvenile: 'Infantil y juvenil',
  'juvenile fiction': 'Infantil y juvenil',
  'young adult fiction': 'Juvenil',
  essays: 'Ensayo',
};

function translateGenre(raw) {
  if (!raw) return '';
  const clean = raw.split('/')[0].trim().toLowerCase();
  return GENRE_MAP[clean] || raw.split('/')[0].trim();
}

const SORTED_GENRES = Array.from(new Set(Object.values(GENRE_MAP))).sort((a, b) =>
  a.localeCompare(b, 'es')
);

function GenreSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const filtered = SORTED_GENRES.filter((g) =>
    g.toLowerCase().includes((value || '').trim().toLowerCase())
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        placeholder="Género (elige o escribe)"
        className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-44 overflow-y-auto bg-white border border-stone-200 rounded-lg shadow-lg text-sm">
          {filtered.map((g) => (
            <li key={g}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(g);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-amber-50 text-stone-800"
              >
                {g}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function fetchBookByIsbn(rawIsbn) {
  const isbn = rawIsbn.replace(/[^0-9Xx]/g, '');
  if (!isbn) throw new Error('ISBN no válido.');

  // 1. Intentar con Google Books API (rápida y con géneros)
  try {
    const gRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`
    );
    if (gRes.ok) {
      const gData = await gRes.json();
      const info = gData.items?.[0]?.volumeInfo;
      if (info?.title) {
        return {
          title: info.title,
          author: Array.isArray(info.authors) ? info.authors.join(', ') : 'Autor desconocido',
          genre: translateGenre(Array.isArray(info.categories) ? info.categories[0] : ''),
          notes: `ISBN: ${isbn}`,
        };
      }
    }
  } catch {
    // Continuar al fallback de Open Library
  }

  // 2. Fallback: Open Library API
  const olRes = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
  );
  if (olRes.ok) {
    const olData = await olRes.json();
    const book = olData[`ISBN:${isbn}`];
    if (book?.title) {
      return {
        title: book.title,
        author: Array.isArray(book.authors)
          ? book.authors.map((a) => a.name).join(', ')
          : 'Autor desconocido',
        genre: translateGenre(
          Array.isArray(book.subjects) ? book.subjects[0]?.name || '' : ''
        ),
        notes: `ISBN: ${isbn}`,
      };
    }
  }

  throw new Error(`No se encontró ningún libro con el ISBN ${isbn}.`);
}

async function searchBookByText(query) {
  const q = query.trim();
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`
  );
  if (!res.ok) throw new Error('Error al buscar en Google Books.');
  const data = await res.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) {
    throw new Error(`No se encontró ningún libro para "${q}".`);
  }
  return {
    title: info.title,
    author: Array.isArray(info.authors) ? info.authors.join(', ') : 'Autor desconocido',
    genre: translateGenre(Array.isArray(info.categories) ? info.categories[0] : ''),
    notes: '',
  };
}

export default function ShelfScanner({ shelves, onOpenNewShelf, onBooksSaved }) {
  const [mode, setMode] = useState('isbn'); // 'isbn' | 'photo'
  const [targetShelfId, setTargetShelfId] = useState(
    shelves.length > 0 ? String(shelves[0].id) : ''
  );
  const [targetBalda, setTargetBalda] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [autoSavePhoto, setAutoSavePhoto] = useState(true);
  const [useLocalOcr, setUseLocalOcr] = useState(!GEMINI_API_KEY);
  const [manualIsbn, setManualIsbn] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [ocrWords, setOcrWords] = useState([]);
  const [ocrTarget, setOcrTarget] = useState('title'); // 'title' | 'author'
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAuthor, setDraftAuthor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [detectedBooks, setDetectedBooks] = useState([]);

  const scannerRef = useRef(null);
  const lastScannedRef = useRef({ isbn: '', time: 0 });
  const photoCameraRef = useRef(null);
  const photoFileRef = useRef(null);

  const effectiveShelfId =
    targetShelfId || (shelves.length > 0 ? String(shelves[0].id) : '');

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignorar si ya estaba detenido
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  async function handleIsbnFound(isbn) {
    const now = Date.now();
    if (
      lastScannedRef.current.isbn === isbn &&
      now - lastScannedRef.current.time < 3000
    ) {
      return;
    }
    lastScannedRef.current = { isbn, time: now };

    setError('');
    setSuccess('');
    setLookingUp(true);
    try {
      const book = await fetchBookByIsbn(isbn);
      setDetectedBooks((prev) => [book, ...prev]);
      setSuccess(`Añadido: "${book.title}"`);
    } catch (err) {
      setError(err.message || 'No se pudo consultar el ISBN.');
    } finally {
      setLookingUp(false);
    }
  }

  async function startScanner() {
    if (!effectiveShelfId) {
      setError('Selecciona primero una estantería de destino.');
      return;
    }
    setError('');
    setSuccess('');
    setScanning(true);

    // Esperar un tick para que el div #isbn-reader exista en el DOM
    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode('isbn-reader');
        scannerRef.current = html5QrCode;
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 120 } },
          (decodedText) => {
            handleIsbnFound(decodedText);
          },
          () => {}
        );
      } catch (err) {
        setScanning(false);
        scannerRef.current = null;
        setError(
          err?.message ||
            'No se pudo acceder a la cámara. Comprueba los permisos del navegador.'
        );
      }
    }, 50);
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualIsbn.trim()) return;
    if (!effectiveShelfId) {
      setError('Selecciona primero una estantería de destino.');
      return;
    }
    const isbn = manualIsbn.trim();
    setManualIsbn('');
    await handleIsbnFound(isbn);
  }

  async function handleTextSearch(e) {
    e.preventDefault();
    if (!textQuery.trim()) return;
    if (!effectiveShelfId) {
      setError('Selecciona primero una estantería de destino.');
      return;
    }
    const q = textQuery.trim();
    setTextQuery('');
    setError('');
    setSuccess('');
    setLookingUp(true);
    try {
      const book = await searchBookByText(q);
      setDetectedBooks((prev) => [book, ...prev]);
      setSuccess(`Añadido: "${book.title}"`);
    } catch (err) {
      setError(err.message || 'No se pudo buscar el libro.');
    } finally {
      setLookingUp(false);
    }
  }

  async function saveBooksToShelf(booksList, shelfId) {
    const valid = booksList.filter((b) => b.title?.trim());
    if (valid.length === 0) return [];

    const res = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        books: valid.map((b) => ({
          title: b.title.trim(),
          author: (b.author || '').trim() || 'Autor desconocido',
          genre: (b.genre || '').trim(),
          notes: (b.notes || '').trim(),
          shelf_id: Number(shelfId),
          position: targetBalda ? Number(targetBalda) : null,
        })),
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Error al guardar los libros');
    }
    const created = await res.json();
    const createdArr = Array.isArray(created) ? created : [created];
    onBooksSaved(createdArr);
    return createdArr;
  }

  async function runLocalOcr(file) {
    const worker = await createWorker('spa+eng');
    let bestWords = [];

    for (const angle of [0, 90, 270]) {
      const blob = angle === 0 ? file : await rotateImageToBlob(file, angle);
      const {
        data: { text },
      } = await worker.recognize(blob);

      const words = (text || '')
        .split(/\s+/)
        .map((w) => w.replace(/^[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]+|[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]+$/g, ''))
        .filter((w) => w.length >= 2);

      if (words.length > bestWords.length) {
        bestWords = words;
      }
      if (bestWords.length >= 4) break;
    }

    await worker.terminate();

    if (bestWords.length === 0) {
      throw new Error(
        'No se pudo leer texto claro en la imagen. Prueba con más luz o usa el buscador manual.'
      );
    }

    setOcrWords(bestWords);
    setSuccess(
      `¡${bestWords.length} palabras detectadas! Pulsa en ellas para asignarlas a Título o Autor.`
    );
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!effectiveShelfId) {
      setError('Selecciona primero una estantería de destino.');
      return;
    }

    setError('');
    setSuccess('');
    setAnalyzingPhoto(true);
    setOcrWords([]);
    setDraftTitle('');
    setDraftAuthor('');
    setOcrTarget('title');

    try {
      if (useLocalOcr || !GEMINI_API_KEY) {
        await runLocalOcr(file);
        return;
      }

      const compressed = await compressImageForGemini(file, 768, 0.58);
      const booksFound = await analyzeShelfWithGemini(
        compressed.base64,
        compressed.mimeType,
        GEMINI_API_KEY
      );

      if (booksFound.length === 0) {
        throw new Error(
          'Gemini no detectó libros legibles en la foto. Prueba acercando un poco más la cámara o con mejor luz.'
        );
      }

      const sizeInfo = `Foto reducida: ${formatBytes(compressed.originalBytes)} → ${formatBytes(compressed.compressedBytes)} (${compressed.width}×${compressed.height}px)`;

      if (autoSavePhoto) {
        const saved = await saveBooksToShelf(booksFound, effectiveShelfId);
        const shelfName =
          shelves.find((s) => String(s.id) === String(effectiveShelfId))?.name ||
          'la estantería';
        const titlesPreview = saved.map((b) => `"${b.title}"`).join(', ');
        setSuccess(
          `¡${saved.length} libro${saved.length === 1 ? '' : 's'} guardado${saved.length === 1 ? '' : 's'} en "${shelfName}"! (${titlesPreview}). ${sizeInfo}`
        );
      } else {
        setDetectedBooks((prev) => [...booksFound, ...prev]);
        setSuccess(
          `¡${booksFound.length} libro${booksFound.length === 1 ? '' : 's'} detectado${booksFound.length === 1 ? '' : 's'}! Revísalos abajo y pulsa Guardar. ${sizeInfo}`
        );
      }
    } catch (err) {
      setError(err.message || 'Error al analizar la imagen.');
    } finally {
      setAnalyzingPhoto(false);
    }
  }

  function handleWordClick(word) {
    if (ocrTarget === 'title') {
      setDraftTitle((prev) => (prev ? `${prev} ${word}` : word));
    } else {
      setDraftAuthor((prev) => (prev ? `${prev} ${word}` : word));
    }
  }

  function handleAddDraftBook() {
    if (!draftTitle.trim()) return;
    setDetectedBooks((prev) => [
      {
        title: draftTitle.trim(),
        author: draftAuthor.trim() || 'Autor desconocido',
        genre: '',
        notes: '',
      },
      ...prev,
    ]);
    setDraftTitle('');
    setDraftAuthor('');
    setOcrWords([]);
    setSuccess('Libro añadido a la lista. Elige su género y guarda.');
  }

  function updateBook(index, field, value) {
    setDetectedBooks((prev) =>
      prev.map((book, i) => (i === index ? { ...book, [field]: value } : book))
    );
  }

  function removeBook(index) {
    setDetectedBooks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveAll() {
    if (!effectiveShelfId) {
      setError('Selecciona una estantería de destino.');
      return;
    }
    if (detectedBooks.filter((b) => b.title.trim()).length === 0) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const saved = await saveBooksToShelf(detectedBooks, effectiveShelfId);
      setDetectedBooks([]);
      setSuccess(`¡${saved.length} libros guardados en la estantería!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-6 space-y-5 w-full overflow-hidden">
      <div>
        <h2 className="text-lg font-semibold text-stone-900 flex items-center gap-2">
          <Barcode className="w-5 h-5 text-amber-600" />
          Escáner de código de barras (ISBN)
        </h2>
        <p className="text-sm text-stone-500 mt-1">
          Apunta con la cámara al código de barras de la contraportada del libro para
          añadirlo al instante.
        </p>
      </div>

      {/* Selector de estantería */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1.5">
          Estantería de destino
        </label>
        <div className="flex flex-wrap gap-2">
          <select
            value={effectiveShelfId}
            onChange={(e) => setTargetShelfId(e.target.value)}
            className="flex-1 min-w-0 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          >
            {shelves.length === 0 && <option value="">Crea una estantería primero</option>}
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={targetBalda}
            onChange={(e) => setTargetBalda(e.target.value)}
            aria-label="Balda (opcional)"
            className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          >
            <option value="">Balda (opcional)</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                Balda {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onOpenNewShelf}
            className="px-3.5 py-2.5 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <FolderPlus className="w-4 h-4" />
            Nueva
          </button>
        </div>
      </div>

      {/* Selector de modo: ISBN vs Foto IA */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-xl">
        <button
          type="button"
          onClick={() => {
            setMode('isbn');
            setError('');
          }}
          className={`py-2.5 px-3 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
            mode === 'isbn'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Barcode className="w-4 h-4 text-amber-600" />
          Escáner ISBN
        </button>
        <button
          type="button"
          onClick={() => {
            if (scanning) stopScanner();
            setMode('photo');
            setError('');
          }}
          className={`py-2.5 px-3 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
            mode === 'photo'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-600" />
          Foto lomos (IA)
        </button>
      </div>

      {mode === 'isbn' ? (
        <>
          {/* Botón cámara + entrada manual */}
          <div className="flex flex-col sm:flex-row gap-3">
            {!scanning ? (
              <button
                type="button"
                onClick={startScanner}
                className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
              >
                <Camera className="w-4 h-4" />
                Abrir cámara y escanear ISBN
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScanner}
                className="flex-1 py-3 px-4 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
              >
                <Square className="w-4 h-4" />
                Detener cámara
              </button>
            )}

            <form onSubmit={handleManualSubmit} className="flex gap-2 flex-1 min-w-0">
              <input
                type="text"
                value={manualIsbn}
                onChange={(e) => setManualIsbn(e.target.value)}
                placeholder="O escribe el ISBN"
                className="flex-1 min-w-0 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={lookingUp || !manualIsbn.trim()}
                className="px-4 py-2.5 rounded-xl bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Buscar
              </button>
            </form>
          </div>

          {/* Visor de cámara */}
          {scanning && (
            <div className="rounded-xl overflow-hidden border border-stone-200 bg-black">
              <div id="isbn-reader" className="w-full" />
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <form onSubmit={handleTextSearch} className="flex gap-2 min-w-0">
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="Buscar por título o autor..."
              className="flex-1 min-w-0 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={lookingUp || !textQuery.trim()}
              className="px-4 py-2.5 shrink-0 rounded-xl bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Buscar
            </button>
          </form>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              ref={photoCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelected}
              className="hidden"
            />
            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelected}
              className="hidden"
            />
            <button
              type="button"
              disabled={analyzingPhoto}
              onClick={() => photoCameraRef.current?.click()}
              className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
            >
              <Camera className="w-4 h-4" />
              Hacer foto (lomo o portada)
            </button>
            <button
              type="button"
              disabled={analyzingPhoto}
              onClick={() => photoFileRef.current?.click()}
              className="flex-1 py-3 px-4 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 disabled:opacity-50 text-stone-800 font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors min-h-[44px]"
            >
              <ImagePlus className="w-4 h-4" />
              Subir imagen
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-600">
            {GEMINI_API_KEY && !useLocalOcr ? (
              <label className="inline-flex items-center gap-2 cursor-pointer select-none font-medium text-stone-700">
                <input
                  type="checkbox"
                  checked={autoSavePhoto}
                  onChange={(e) => setAutoSavePhoto(e.target.checked)}
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                />
                Guardar automáticamente en la estantería
              </label>
            ) : (
              <span>
                {GEMINI_API_KEY
                  ? 'Modo OCR local activo (sin consumo de API).'
                  : 'Falta VITE_GEMINI_API_KEY: usando OCR local.'}
              </span>
            )}

            <div className="flex items-center gap-3">
              {GEMINI_API_KEY && !useLocalOcr && (
                <span className="text-stone-500">
                  Compresión iPhone máx. 768px · bajo consumo
                </span>
              )}
              {GEMINI_API_KEY && (
                <button
                  type="button"
                  onClick={() => setUseLocalOcr((v) => !v)}
                  className="text-amber-700 hover:underline font-medium"
                >
                  {useLocalOcr ? 'Usar Gemini IA' : 'Usar OCR local'}
                </button>
              )}
            </div>
          </div>

          {/* Selector interactivo de palabras OCR */}
          {ocrWords.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
                  Toca las palabras para asignarlas:
                </p>
                <div className="inline-flex rounded-lg bg-stone-200/80 p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setOcrTarget('title')}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      ocrTarget === 'title'
                        ? 'bg-white text-amber-800 shadow-xs'
                        : 'text-stone-600'
                    }`}
                  >
                    → Título
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrTarget('author')}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      ocrTarget === 'author'
                        ? 'bg-white text-amber-800 shadow-xs'
                        : 'text-stone-600'
                    }`}
                  >
                    → Autor
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ocrWords.map((word, idx) => (
                  <button
                    key={`${word}-${idx}`}
                    type="button"
                    onClick={() => handleWordClick(word)}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 hover:border-amber-400 hover:bg-amber-50 text-xs font-medium text-stone-800 active:scale-95 transition-all"
                  >
                    {word}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onFocus={() => setOcrTarget('title')}
                  placeholder="Título seleccionado..."
                  className={`w-full min-w-0 px-3 py-2 bg-white border rounded-lg text-sm ${
                    ocrTarget === 'title' ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-stone-200'
                  }`}
                />
                <input
                  type="text"
                  value={draftAuthor}
                  onChange={(e) => setDraftAuthor(e.target.value)}
                  onFocus={() => setOcrTarget('author')}
                  placeholder="Autor seleccionado..."
                  className={`w-full min-w-0 px-3 py-2 bg-white border rounded-lg text-sm ${
                    ocrTarget === 'author' ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-stone-200'
                  }`}
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDraftTitle('');
                    setDraftAuthor('');
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-200/60"
                >
                  Limpiar campos
                </button>
                <button
                  type="button"
                  disabled={!draftTitle.trim()}
                  onClick={handleAddDraftBook}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Añadir libro a la lista
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(lookingUp || analyzingPhoto) && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {analyzingPhoto
            ? 'Analizando lomos con Gemini...'
            : 'Buscando datos del libro...'}
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {success}
        </div>
      )}

      {/* Lista de libros escaneados */}
      {detectedBooks.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-stone-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">
              Libros escaneados ({detectedBooks.length})
            </h3>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Guardar en estantería
            </button>
          </div>

          <div className="space-y-2.5">
            {detectedBooks.map((book, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl border border-stone-200 bg-stone-50/60 flex flex-col sm:flex-row gap-2.5 items-start sm:items-center"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 w-full">
                  <input
                    type="text"
                    value={book.title}
                    onChange={(e) => updateBook(idx, 'title', e.target.value)}
                    placeholder="Título"
                    className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    value={book.author}
                    onChange={(e) => updateBook(idx, 'author', e.target.value)}
                    placeholder="Autor"
                    className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                  />
                  <GenreSelect
                    value={book.genre}
                    onChange={(val) => updateBook(idx, 'genre', val)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeBook(idx)}
                  aria-label="Quitar libro"
                  className="p-2 text-stone-400 hover:text-red-600 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
