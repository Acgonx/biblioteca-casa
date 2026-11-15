import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { GoogleGenAI } from '@google/genai';
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

const MAX_BASE64_LENGTH = 550_000; // ~400 KB

function compressImageToBase64(file, maxSize = 1024, quality = 0.72) {
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
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      let currentQuality = quality;
      let base64 = canvas.toDataURL('image/jpeg', currentQuality).split(',')[1] || '';
      while (base64.length > MAX_BASE64_LENGTH && currentQuality > 0.35) {
        currentQuality -= 0.15;
        base64 = canvas.toDataURL('image/jpeg', currentQuality).split(',')[1] || '';
      }
      resolve(base64);
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
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query.trim())}&maxResults=1`
  );
  if (!res.ok) throw new Error('Error al buscar en Google Books.');
  const data = await res.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) {
    throw new Error(`No se encontró ningún libro para "${query}".`);
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
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [manualIsbn, setManualIsbn] = useState('');
  const [textQuery, setTextQuery] = useState('');
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

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!effectiveShelfId) {
      setError('Selecciona primero una estantería de destino.');
      return;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey || apiKey.includes('tu-api-key')) {
      setError('Falta configurar VITE_GEMINI_API_KEY en tu archivo .env.');
      return;
    }

    setError('');
    setSuccess('');
    setAnalyzingPhoto(true);

    try {
      const base64Data = await compressImageToBase64(file);
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `Analiza esta fotografía de una estantería o lomos de libros.
Lee con precisión los títulos y autores impresos VERTICALMENTE (de arriba a abajo o de abajo a arriba) en los lomos, o en la portada si es un libro suelto.
Si algún lomo solo muestra el título, infiere o completa el autor si es evidente, o indica "Autor desconocido".

Devuelve EXCLUSIVAMENTE un array JSON válido (sin markdown ni texto adicional). Cada objeto debe tener:
- "title": string
- "author": string
- "genre": string (género literario estimado en español)
- "notes": string (breve nota o "")`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsed = JSON.parse((response.text || '[]').trim());
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('No se pudieron identificar libros en la imagen.');
      }
      setDetectedBooks((prev) => [...parsed, ...prev]);
      setSuccess(`¡${parsed.length} libros detectados en la foto!`);
    } catch (err) {
      setError(err.message || 'Error al analizar la imagen con Gemini.');
    } finally {
      setAnalyzingPhoto(false);
    }
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
    const valid = detectedBooks.filter((b) => b.title.trim());
    if (valid.length === 0) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          books: valid.map((b) => ({
            title: b.title.trim(),
            author: (b.author || '').trim() || 'Autor desconocido',
            genre: (b.genre || '').trim(),
            notes: (b.notes || '').trim(),
            shelf_id: Number(effectiveShelfId),
          })),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al guardar los libros');
      }
      const created = await res.json();
      onBooksSaved(Array.isArray(created) ? created : [created]);
      setDetectedBooks([]);
      setSuccess(
        `¡${Array.isArray(created) ? created.length : 1} libros guardados en la estantería!`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 sm:p-6 space-y-5">
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
            className="flex-1 min-w-[200px] px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          >
            {shelves.length === 0 && <option value="">Crea una estantería primero</option>}
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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

            <form onSubmit={handleManualSubmit} className="flex gap-2 flex-1">
              <input
                type="text"
                value={manualIsbn}
                onChange={(e) => setManualIsbn(e.target.value)}
                placeholder="O escribe el ISBN (ej. 9788497592208)"
                className="flex-1 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
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
          <form onSubmit={handleTextSearch} className="flex gap-2">
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="Buscar por título o autor sin IA (ej. Cien años de soledad)"
              className="flex-1 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={lookingUp || !textQuery.trim()}
              className="px-4 py-2.5 rounded-xl bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-1.5"
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
            Hacer foto a lomos
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
                  <input
                    type="text"
                    value={book.genre}
                    onChange={(e) => updateBook(idx, 'genre', e.target.value)}
                    placeholder="Género"
                    className="px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
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
