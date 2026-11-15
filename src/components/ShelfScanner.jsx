import { useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Camera,
  Check,
  FolderPlus,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ShelfScanner({ shelves, onOpenNewShelf, onBooksSaved }) {
  const [targetShelfId, setTargetShelfId] = useState(
    shelves.length > 0 ? String(shelves[0].id) : ''
  );
  const [previewUrl, setPreviewUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [detectedBooks, setDetectedBooks] = useState([]);

  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const effectiveShelfId =
    targetShelfId || (shelves.length > 0 ? String(shelves[0].id) : '');

  async function handleImageSelected(e) {
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
    setDetectedBooks([]);
    setPreviewUrl(URL.createObjectURL(file));
    setAnalyzing(true);

    try {
      const base64Data = await fileToBase64(file);
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `Analiza esta fotografía de una estantería o balda con libros.
Tu tarea principal es leer y descifrar con la máxima precisión posible los títulos y autores impresos VERTICALMENTE (de arriba a abajo o de abajo a arriba) en los lomos de los libros ordenados en la balda.
Si algún lomo solo muestra el título o es parcialmente legible, infiere o completa el autor si es evidente, o indica "Autor desconocido".

Devuelve EXCLUSIVAMENTE un array JSON válido (sin markdown ni texto adicional). Cada objeto del array debe tener estrictamente estas 4 propiedades:
- "title": string (título del libro)
- "author": string (autor del libro)
- "genre": string (género literario estimado en español)
- "notes": string (breve nota si algún detalle es incierto o está vacío "")`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: file.type || 'image/jpeg',
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

      const rawText = (response.text || '[]').trim();
      const parsed = JSON.parse(rawText);
      const list = Array.isArray(parsed) ? parsed : parsed.books || [];

      if (list.length === 0) {
        setError('No se pudieron detectar libros legibles en la imagen. Prueba con una foto más nítida.');
      } else {
        setDetectedBooks(
          list.map((b, idx) => ({
            title: b.title || '',
            author: b.author || 'Autor desconocido',
            genre: b.genre || '',
            notes: b.notes || '',
            position: idx + 1,
          }))
        );
      }
    } catch (err) {
      console.error('Error al analizar con Gemini:', err);
      setError(err.message || 'Error al analizar la imagen con Gemini.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveDetected() {
    if (!effectiveShelfId) {
      setError('Debes seleccionar una estantería de destino.');
      return;
    }

    const valid = detectedBooks.filter((b) => b.title.trim() && b.author.trim());
    if (valid.length === 0) return;

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          books: valid.map((b) => ({
            ...b,
            shelf_id: Number(effectiveShelfId),
          })),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudieron guardar los libros.');
      }
      const created = await res.json();
      const createdArr = Array.isArray(created) ? created : [created];
      onBooksSaved(createdArr);
      setSuccess(`Se guardaron ${createdArr.length} libro(s) en la estantería.`);
      setDetectedBooks([]);
      setPreviewUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-3xl mx-auto space-y-6">
      {/* Paso 1: Selección obligatoria de estantería */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-2 text-amber-700">
          <Sparkles className="w-5 h-5" />
          <h2 className="font-semibold text-stone-900 text-base">
            1. ¿A qué estantería vas a añadir estos libros?
          </h2>
        </div>

        {shelves.length === 0 ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              Aún no tienes ninguna estantería creada. Crea una para poder escanear.
            </p>
            <button
              type="button"
              onClick={onOpenNewShelf}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl bg-stone-900 text-white text-sm font-medium shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
              Crear estantería
            </button>
          </div>
        ) : (
          <select
            value={effectiveShelfId}
            onChange={(e) => setTargetShelfId(e.target.value)}
            required
            className="w-full px-3.5 py-3 min-h-[44px] bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          >
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Paso 2: Captura o carga de foto */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 space-y-4 shadow-sm">
        <h2 className="font-semibold text-stone-900 text-base">
          2. Captura o sube una foto de la balda
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!effectiveShelfId || analyzing}
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-3.5 min-h-[48px] rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition-colors"
          >
            <Camera className="w-5 h-5" />
            Hacer foto con cámara
          </button>

          <button
            type="button"
            disabled={!effectiveShelfId || analyzing}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-3.5 min-h-[48px] rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-800 text-sm font-semibold transition-colors"
          >
            <ImagePlus className="w-5 h-5" />
            Subir imagen
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageSelected}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelected}
          className="hidden"
        />

        {previewUrl && (
          <div className="mt-3 rounded-xl overflow-hidden border border-stone-200 bg-stone-100 max-h-72 flex items-center justify-center">
            <img
              src={previewUrl}
              alt="Vista previa de la estantería"
              className="max-h-72 w-auto object-contain"
            />
          </div>
        )}

        {analyzing && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-amber-600 shrink-0" />
            <span className="font-medium">Analizando estantería y lomos con Gemini...</span>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}
      </div>

      {/* Paso 3: Lista previa editable y guardado */}
      {detectedBooks.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-stone-900 text-base">
              3. Revisa los libros detectados ({detectedBooks.length})
            </h2>
          </div>

          <div className="space-y-3">
            {detectedBooks.map((book, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-xl bg-stone-50 border border-stone-200/80"
              >
                <input
                  type="text"
                  value={book.title}
                  placeholder="Título"
                  onChange={(e) =>
                    setDetectedBooks((prev) =>
                      prev.map((b, i) => (i === idx ? { ...b, title: e.target.value } : b))
                    )
                  }
                  className="sm:col-span-4 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                />
                <input
                  type="text"
                  value={book.author}
                  placeholder="Autor"
                  onChange={(e) =>
                    setDetectedBooks((prev) =>
                      prev.map((b, i) => (i === idx ? { ...b, author: e.target.value } : b))
                    )
                  }
                  className="sm:col-span-3 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                />
                <input
                  type="text"
                  value={book.genre}
                  placeholder="Género"
                  onChange={(e) =>
                    setDetectedBooks((prev) =>
                      prev.map((b, i) => (i === idx ? { ...b, genre: e.target.value } : b))
                    )
                  }
                  className="sm:col-span-2 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                />
                <div className="sm:col-span-3 flex gap-2">
                  <input
                    type="text"
                    value={book.notes}
                    placeholder="Notas"
                    onChange={(e) =>
                      setDetectedBooks((prev) =>
                        prev.map((b, i) => (i === idx ? { ...b, notes: e.target.value } : b))
                      )
                    }
                    className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDetectedBooks((prev) => prev.filter((_, i) => i !== idx))
                    }
                    aria-label="Quitar libro"
                    className="p-2.5 text-stone-400 hover:text-red-600 rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveDetected}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar en la estantería
          </button>
        </div>
      )}
    </section>
  );
}
