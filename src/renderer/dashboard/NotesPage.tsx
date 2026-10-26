// Notes rapides : liste + éditeur avec enregistrement automatique.

import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../../shared/defaults';
import type { AppSnapshot, Note } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { toast, useDebouncedCallback } from '../components/ui';

function NoteEditor({ note }: { note: Note }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note.title, note.content]);

  const save = useDebouncedCallback(async (patch: { title?: string; content?: string }) => {
    const r = await api.notes.update(note.id, patch);
    if (r.ok) setStatus('saved');
    else toast(Object.values(r.errors)[0] ?? 'Erreur', 'error');
  }, 450);

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  return (
    <div className="card note-editor" onFocus={() => (focused.current = true)} onBlur={() => { focused.current = false; save.flush(); }}>
      <input
        className="title-input"
        value={title}
        maxLength={LIMITS.noteTitleMax}
        placeholder="Titre de la note"
        onChange={(e) => {
          setTitle(e.target.value);
          setStatus('saving');
          save.call({ title: e.target.value, content });
        }}
      />
      <textarea
        value={content}
        placeholder="Écrivez vos idées, listes, informations utiles…"
        spellCheck
        onChange={(e) => {
          setContent(e.target.value);
          setStatus('saving');
          save.call({ title, content: e.target.value });
        }}
      />
      <div className="foot">
        <Icon name={status === 'saved' ? 'check' : 'clock'} size={13} />
        {status === 'saved' ? 'Enregistré automatiquement' : 'Enregistrement…'}
        <span style={{ marginLeft: 'auto' }}>
          {words} mot{words > 1 ? 's' : ''} · modifiée le {new Date(note.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>
    </div>
  );
}

export function NotesPage({ snapshot, initialId }: { snapshot: AppSnapshot; initialId?: string }) {
  const [activeId, setActiveId] = useState<string | null>(initialId ?? snapshot.notes[0]?.id ?? null);
  useEffect(() => {
    if (initialId) setActiveId(initialId);
  }, [initialId]);
  const active = snapshot.notes.find((n) => n.id === activeId) ?? snapshot.notes[0] ?? null;

  const create = async () => {
    const r = await api.notes.create({ title: 'Nouvelle note' });
    if (r.ok) setActiveId(r.value.id);
  };
  const remove = async (note: Note) => {
    if (!(await api.app.confirm(`Supprimer la note « ${note.title || 'Sans titre'} » ?`, 'Cette action est définitive.'))) return;
    const r = await api.notes.remove(note.id);
    if (r.ok) toast('Note supprimée');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Notes rapides</h1>
          <p>Vos notes sont aussi accessibles depuis le widget « Notes rapides » du bureau.</p>
        </div>
        <span className="spacer" />
        {active && (
          <button type="button" className="btn btn-ghost" onClick={() => void remove(active)}>
            <Icon name="trash" /> Supprimer
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void create()}>
          <Icon name="plus" /> Nouvelle note
        </button>
      </div>
      {snapshot.notes.length === 0 ? (
        <div className="card empty" style={{ padding: 48 }}>
          <Icon name="note" />
          <strong>Aucune note</strong>
          <button type="button" className="btn btn-primary" onClick={() => void create()}>
            Créer une note
          </button>
        </div>
      ) : (
        <div className="notes-layout">
          <div className="card notes-list">
            {snapshot.notes.map((n) => (
              <button type="button" key={n.id} className={`note-item ${active?.id === n.id ? 'on' : ''}`} onClick={() => setActiveId(n.id)}>
                <strong>{n.title || 'Sans titre'}</strong>
                <span>{n.content.split('\n')[0] || 'Note vide'}</span>
              </button>
            ))}
          </div>
          {active && <NoteEditor key={active.id} note={active} />}
        </div>
      )}
    </div>
  );
}
