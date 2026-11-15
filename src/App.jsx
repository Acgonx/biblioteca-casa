import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  BookOpen,
  Camera,
  Check,
  FolderPlus,
  Layers,
  Library,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import ShelfScanner from './components/ShelfScanner.jsx';

const EMPTY_ROW = () => ({ title: '', author: '', genre: '', notes: '' });

export default function App() {
  const [shelves, setShelves] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('shelves'); // 'shelves' | 'bulk'
  const [search, setSearch] = useState('');

  // Modal: Nueva estantería
  const [showNewShelf, setShowNewShelf] = useState(false);
  const [shelfName, setShelfName] = useState('');
  const [shelfDesc, setShelfDesc] = useState('');
  const [savingShelf, setSavingShelf] = useState(false);

  // Modal: Reubicar libro
  const [movingBook, setMovingBook] = useState(null);
  const [movingBusy, setMovingBusy] = useState(false);

  // Módulo de entrada masiva
  const [bulkShelfId, setBulkShelfId] = useState('');
  const [bulkRows, setBulkRows] = useState([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);
  const [quickPaste, setQuickPaste] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSuccess, setBulkSuccess] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [sRes, bRes] = await Promise.all([fetch('/api/shelves'), fetch('/api/books')]);
      if (!sRes.ok || !bRes.ok) {
        const errData = await (!sRes.ok ? sRes : bRes).json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo conectar con la base de datos.');
      }
      const [sData, bData] = await Promise.all([sRes.json(), bRes.json()]);
      setShelves(sData);
      setBooks(bData);
      if (sData.length > 0 && !bulkShelfId) {
        setBulkShelfId(String(sData[0].id));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.genre && b.genre.toLowerCase().includes(q))
    );
  }, [books, search]);

  const unassignedBooks = useMemo(
    () => filteredBooks.filter((b) => !b.shelf_id),
    [filteredBooks]
  );

  async function handleCreateShelf(e) {
    e.preventDefault();
    if (!shelfName.trim()) return;
    setSavingShelf(true);
    try {
      const res = await fetch('/api/shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: shelfName, description: shelfDesc }),
      });
      if (!res.ok) throw new Error('Error al crear la estantería');
      const created = await res.json();
      setShelves((prev) => [...prev, created]);
      setShelfName('');
      setShelfDesc('');
      setShowNewShelf(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingShelf(false);
    }
  }

  async function handleMoveBook(bookId, targetShelfId) {
    setMovingBusy(true);
    try {
      const res = await fetch('/api/books', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bookId,
          shelf_id: targetShelfId === '' ? null : Number(targetShelfId),
        }),
      });
      if (!res.ok) throw new Error('No se pudo reubicar el libro');
      const updated = await res.json();
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setMovingBook(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setMovingBusy(false);
    }
  }

  async function handleDeleteBook(bookId) {
    try {
      const res = await fetch(`/api/books?id=${bookId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar el libro');
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
    } catch (err) {
      setError(err.message);
    }
  }

  function handleQuickPasteParse() {
    const lines = quickPaste
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const parsed = lines.map((line) => {
      const parts = line.includes('|') ? line.split('|') : line.split(' - ');
      return {
        title: (parts[0] || '').trim(),
        author: (parts[1] || 'Autor desconocido').trim(),
        genre: (parts[2] || '').trim(),
        notes: '',
      };
    });
    setBulkRows(parsed);
    setQuickPaste('');
  }

  async function handleBulkSave(e) {
    e.preventDefault();
    const valid = bulkRows.filter((r) => r.title.trim() && r.author.trim());
    if (valid.length === 0) return;

    setBulkSaving(true);
    setBulkSuccess('');
    setError('');
    try {
      const payload = {
        books: valid.map((r) => ({
          ...r,
          shelf_id: bulkShelfId ? Number(bulkShelfId) : null,
        })),
      };
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Error al guardar los libros');
      const created = await res.json();
      const createdArr = Array.isArray(created) ? created : [created];
      setBooks((prev) => [...prev, ...createdArr]);
      setBulkRows([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);
      setBulkSuccess(`Se añadieron ${createdArr.length} libro(s) correctamente.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col pb-20 sm:pb-8">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-600 text-white rounded-xl shadow-sm">
              <Library className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight leading-none">
                Biblioteca Casera
              </h1>
              <p className="text-xs text-stone-500 mt-0.5">
                {books.length} libros · {shelves.length} estanterías
              </p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden sm:flex items-center gap-1.5 bg-stone-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setView('shelves')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'shelves'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              Estanterías
            </button>
            <button
              type="button"
              onClick={() => setView('bulk')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'bulk'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Plus className="w-4 h-4" />
              Entrada Masiva
            </button>
            <button
              type="button"
              onClick={() => setView('scan')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'scan'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Camera className="w-4 h-4" />
              Escanear balda con IA
            </button>
          </nav>

          <button
            type="button"
            onClick={() => setShowNewShelf(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 active:scale-[0.98] transition-all shadow-sm"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Nueva balda</span>
            <span className="sm:hidden">Balda</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6">
        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-stone-500 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
            <p className="text-sm font-medium">Conectando con tu biblioteca...</p>
          </div>
        ) : view === 'scan' ? (
          <ShelfScanner
            shelves={shelves}
            onOpenNewShelf={() => setShowNewShelf(true)}
            onBooksSaved={(createdArr) => setBooks((prev) => [...prev, ...createdArr])}
          />
        ) : view === 'shelves' ? (
          <>
            {/* Search */}
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar libro, autor o género..."
                className="w-full pl-10 pr-4 py-3 bg-white border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            {/* Shelves Dashboard */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {shelves.map((shelf) => {
                const shelfBooks = filteredBooks.filter((b) => b.shelf_id === shelf.id);
                return (
                  <section
                    key={shelf.id}
                    className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col"
                  >
                    <div className="px-5 py-4 bg-stone-50/70 border-b border-stone-200 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-stone-900">{shelf.name}</h2>
                        {shelf.description && (
                          <p className="text-xs text-stone-500 mt-0.5">{shelf.description}</p>
                        )}
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                        {shelfBooks.length}
                      </span>
                    </div>

                    <div className="p-3 sm:p-4 space-y-2.5 flex-1">
                      {shelfBooks.length === 0 ? (
                        <div className="py-8 text-center text-stone-400 text-sm">
                          Estantería vacía
                        </div>
                      ) : (
                        shelfBooks.map((book) => (
                          <div
                            key={book.id}
                            className="p-3.5 rounded-xl border border-stone-200/80 bg-stone-50/40 hover:bg-white hover:border-stone-300 transition-all flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <h3 className="font-medium text-stone-900 text-sm truncate">
                                {book.title}
                              </h3>
                              <p className="text-xs text-stone-500 truncate mt-0.5">
                                {book.author}
                                {book.genre ? ` · ${book.genre}` : ''}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setMovingBook(book)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-medium transition-colors"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                Mover
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBook(book.id)}
                                aria-label="Eliminar libro"
                                className="p-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}

              {/* Unassigned Books */}
              {unassignedBooks.length > 0 && (
                <section className="bg-white rounded-2xl border border-dashed border-stone-300 overflow-hidden flex flex-col">
                  <div className="px-5 py-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-stone-800">Sin estantería asignada</h2>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Libros pendientes de ubicar en una balda
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-stone-200 text-stone-700 text-xs font-semibold">
                      {unassignedBooks.length}
                    </span>
                  </div>
                  <div className="p-3 sm:p-4 space-y-2.5">
                    {unassignedBooks.map((book) => (
                      <div
                        key={book.id}
                        className="p-3.5 rounded-xl border border-stone-200 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-stone-900 text-sm truncate">
                            {book.title}
                          </h3>
                          <p className="text-xs text-stone-500 truncate mt-0.5">{book.author}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMovingBook(book)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-amber-600 text-white hover:bg-amber-700 text-xs font-medium transition-colors"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Ubicar
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        ) : (
          /* Bulk Entry Module */
          <section className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 text-amber-700">
                <Sparkles className="w-5 h-5" />
                <h2 className="font-semibold text-stone-900 text-base">
                  Pegado rápido (opcional)
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-stone-500">
                Pega una lista de libros, uno por línea, con el formato{' '}
                <code className="px-1.5 py-0.5 bg-stone-100 rounded text-stone-700">
                  Título | Autor | Género
                </code>
                .
              </p>
              <textarea
                rows={3}
                value={quickPaste}
                onChange={(e) => setQuickPaste(e.target.value)}
                placeholder={'Dune | Frank Herbert | Ciencia ficción\nEl Hobbit | J.R.R. Tolkien | Fantasía'}
                className="w-full p-3.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleQuickPasteParse}
                className="px-4 py-2.5 min-h-[44px] rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-sm font-medium transition-colors"
              >
                Rellenar filas automáticamente
              </button>
            </div>

            <form
              onSubmit={handleBulkSave}
              className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 space-y-5 shadow-sm"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-semibold text-stone-900 text-base flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-600" />
                  Entrada masiva de libros
                </h2>

                <select
                  value={bulkShelfId}
                  onChange={(e) => setBulkShelfId(e.target.value)}
                  className="px-3.5 py-2.5 min-h-[44px] bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="">Sin estantería asignada</option>
                  {shelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      Destino: {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                {bulkRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-xl bg-stone-50 border border-stone-200/70"
                  >
                    <input
                      type="text"
                      placeholder="Título *"
                      value={row.title}
                      onChange={(e) =>
                        setBulkRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, title: e.target.value } : r))
                        )
                      }
                      className="sm:col-span-5 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Autor *"
                      value={row.author}
                      onChange={(e) =>
                        setBulkRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, author: e.target.value } : r))
                        )
                      }
                      className="sm:col-span-4 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                    />
                    <div className="sm:col-span-3 flex gap-2">
                      <input
                        type="text"
                        placeholder="Género"
                        value={row.genre}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, genre: e.target.value } : r))
                          )
                        }
                        className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm"
                      />
                      {bulkRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setBulkRows((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-2.5 text-stone-400 hover:text-red-600 rounded-xl"
                          aria-label="Quitar fila"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {bulkSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  {bulkSuccess}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBulkRows((prev) => [...prev, EMPTY_ROW()])}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl border border-stone-200 hover:bg-stone-50 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Añadir otra fila
                </button>

                <button
                  type="submit"
                  disabled={bulkSaving}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition-colors"
                >
                  {bulkSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar libros en biblioteca
                </button>
              </div>
            </form>
          </section>
        )}
      </main>

      {/* Mobile Bottom Navigation (iPhone friendly) */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur-md border-t border-stone-200 px-4 py-2 flex items-center justify-around">
        <button
          type="button"
          onClick={() => setView('shelves')}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 text-xs font-medium ${
            view === 'shelves' ? 'text-amber-700 bg-amber-50' : 'text-stone-500'
          }`}
        >
          <Layers className="w-5 h-5" />
          Estanterías
        </button>
        <button
          type="button"
          onClick={() => setView('bulk')}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 text-xs font-medium ${
            view === 'bulk' ? 'text-amber-700 bg-amber-50' : 'text-stone-500'
          }`}
        >
          <Plus className="w-5 h-5" />
          Entrada Masiva
        </button>
        <button
          type="button"
          onClick={() => setView('scan')}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 text-xs font-medium ${
            view === 'scan' ? 'text-amber-700 bg-amber-50' : 'text-stone-500'
          }`}
        >
          <Camera className="w-5 h-5" />
          Escanear IA
        </button>
      </nav>

      {/* Modal: Nueva Estantería */}
      {showNewShelf && (
        <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleCreateShelf}
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Nueva estantería</h3>
              <button
                type="button"
                onClick={() => setShowNewShelf(false)}
                className="p-2 rounded-xl text-stone-400 hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="Nombre (ej. Salón · Balda Inferior)"
              value={shelfName}
              onChange={(e) => setShelfName(e.target.value)}
              className="w-full px-3.5 py-3 border border-stone-200 rounded-xl text-sm"
            />
            <input
              type="text"
              placeholder="Descripción opcional"
              value={shelfDesc}
              onChange={(e) => setShelfDesc(e.target.value)}
              className="w-full px-3.5 py-3 border border-stone-200 rounded-xl text-sm"
            />
            <button
              type="submit"
              disabled={savingShelf}
              className="w-full py-3 min-h-[44px] rounded-xl bg-stone-900 text-white font-semibold text-sm hover:bg-stone-800 disabled:opacity-50"
            >
              {savingShelf ? 'Guardando...' : 'Crear estantería'}
            </button>
          </form>
        </div>
      )}

      {/* Modal: Reubicar Libro */}
      {movingBook && (
        <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-amber-700 uppercase tracking-wider">
                  Reubicar libro
                </p>
                <h3 className="font-bold text-lg leading-snug mt-0.5">{movingBook.title}</h3>
                <p className="text-sm text-stone-500">{movingBook.author}</p>
              </div>
              <button
                type="button"
                onClick={() => setMovingBook(null)}
                className="p-2 rounded-xl text-stone-400 hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {shelves.map((s) => {
                const isCurrent = movingBook.shelf_id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={movingBusy || isCurrent}
                    onClick={() => handleMoveBook(movingBook.id, s.id)}
                    className={`w-full text-left px-4 py-3 min-h-[44px] rounded-xl border text-sm font-medium flex items-center justify-between transition-colors ${
                      isCurrent
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-white border-stone-200 hover:bg-stone-50 text-stone-800'
                    }`}
                  >
                    <span>{s.name}</span>
                    {isCurrent && <span className="text-xs text-amber-700">Actual</span>}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={movingBusy || !movingBook.shelf_id}
                onClick={() => handleMoveBook(movingBook.id, '')}
                className="w-full text-left px-4 py-3 min-h-[44px] rounded-xl border border-dashed border-stone-300 text-sm text-stone-600 hover:bg-stone-50"
              >
                Dejar sin estantería asignada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
