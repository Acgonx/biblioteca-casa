import { getSupabase } from './_db.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .order('shelf_id', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });

      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const payload = req.body;
      const items = Array.isArray(payload?.books)
        ? payload.books
        : Array.isArray(payload)
          ? payload
          : [payload];

      const validItems = items
        .filter((b) => b?.title?.trim() && b?.author?.trim())
        .map((item) => ({
          title: item.title.trim(),
          author: item.author.trim(),
          genre: item.genre?.trim() || null,
          shelf_id: item.shelf_id ? Number(item.shelf_id) : null,
          position: item.position != null ? Number(item.position) : null,
          notes: item.notes?.trim() || null,
          cover_url: item.cover_url?.trim() || null,
        }));

      if (validItems.length === 0) {
        return res.status(400).json({ error: 'Debes indicar al menos título y autor.' });
      }

      const { data, error } = await supabase.from('books').insert(validItems).select();
      if (error) throw error;

      const result =
        data.length === 1 && !Array.isArray(payload?.books) ? data[0] : data;
      return res.status(201).json(result);
    }

    if (req.method === 'PATCH') {
      const { id, shelf_id, position, title, author, genre, notes, cover_url } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'El ID del libro es obligatorio.' });
      }

      const updates = {};
      if (shelf_id !== undefined) {
        updates.shelf_id = shelf_id === null || shelf_id === '' ? null : Number(shelf_id);
      }
      if (position !== undefined) {
        updates.position = position === null ? null : Number(position);
      }
      if (title !== undefined) updates.title = title.trim();
      if (author !== undefined) updates.author = author.trim();
      if (genre !== undefined) updates.genre = genre?.trim() || null;
      if (notes !== undefined) updates.notes = notes?.trim() || null;
      if (cover_url !== undefined) updates.cover_url = cover_url?.trim() || null;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No hay campos para actualizar.' });
      }

      const { data, error } = await supabase
        .from('books')
        .update(updates)
        .eq('id', Number(id))
        .select()
        .single();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Libro no encontrado.' });
      }
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const shelfId = Number(req.query?.shelf_id || req.body?.shelf_id);
      if (shelfId) {
        const { error } = await supabase.from('books').delete().eq('shelf_id', shelfId);
        if (error) throw error;
        return res.status(200).json({ ok: true, clearedShelfId: shelfId });
      }

      const id = Number(req.query?.id || req.body?.id);
      if (!id) {
        return res.status(400).json({ error: 'ID de libro inválido.' });
      }

      const { error } = await supabase.from('books').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en /api/books:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
