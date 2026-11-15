import { getSupabase } from './_db.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('shelves')
        .select('*')
        .order('id', { ascending: true });

      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const { name, description } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre de la estantería es obligatorio.' });
      }

      const { data, error } = await supabase
        .from('shelves')
        .insert({ name: name.trim(), description: description?.trim() || null })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query?.id || req.body?.id);
      if (!id) {
        return res.status(400).json({ error: 'ID de estantería inválido.' });
      }

      const { error } = await supabase.from('shelves').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en /api/shelves:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
