// Gestion des projets / catégories.

import { useMemo, useState } from 'react';
import { LIMITS, PROJECT_COLORS } from '../../shared/defaults';
import type { AppSnapshot, Project } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Field, Modal, toast } from '../components/ui';

function ProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = project ? await api.projects.update(project.id, { name, color }) : await api.projects.create({ name, color });
    if (!r.ok) {
      setError(Object.values(r.errors)[0] ?? 'Erreur');
      return;
    }
    toast(project ? 'Projet modifié' : 'Projet créé');
    onClose();
  };
  return (
    <Modal
      title={project ? 'Modifier le projet' : 'Nouveau projet'}
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            {project ? 'Enregistrer' : 'Créer'}
          </button>
        </>
      }
    >
      <Field label="Nom" error={error ?? undefined}>
        <input
          className={`input ${error ? 'invalid' : ''}`}
          autoFocus
          value={name}
          maxLength={LIMITS.projectNameMax}
          placeholder="ex. Travail, Maison, Études…"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </Field>
      <Field label="Couleur">
        <div className="color-swatches">
          {PROJECT_COLORS.map((c) => (
            <button type="button" key={c} className={color === c ? 'on' : ''} style={{ background: c }} aria-label={`Couleur ${c}`} onClick={() => setColor(c)} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Couleur personnalisée" />
        </div>
      </Field>
    </Modal>
  );
}

export function ProjectsPage({ snapshot, openProject }: { snapshot: AppSnapshot; openProject: (id: string) => void }) {
  const [editing, setEditing] = useState<Project | null | 'new'>(null);
  const counts = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const t of snapshot.tasks) {
      if (!t.projectId) continue;
      const c = m.get(t.projectId) ?? { total: 0, done: 0 };
      c.total += 1;
      if (t.status === 'done') c.done += 1;
      m.set(t.projectId, c);
    }
    return m;
  }, [snapshot.tasks]);

  const remove = async (p: Project) => {
    const c = counts.get(p.id);
    const ok = await api.app.confirm(
      `Supprimer le projet « ${p.name} » ?`,
      c?.total ? `Ses ${c.total} tâche(s) seront conservées et passeront dans « Sans projet ».` : '',
    );
    if (!ok) return;
    const r = await api.projects.remove(p.id);
    if (r.ok) toast('Projet supprimé');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projets</h1>
          <p>Regroupez vos tâches par projet ou par catégorie. Astuce : tapez « #Nom » dans une tâche.</p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Nouveau projet
        </button>
      </div>
      <div className="project-grid">
        {snapshot.projects.map((p) => {
          const c = counts.get(p.id) ?? { total: 0, done: 0 };
          const ratio = c.total ? c.done / c.total : 0;
          return (
            <div key={p.id} className="card project-card" role="button" tabIndex={0} onClick={() => openProject(p.id)} onKeyDown={(e) => e.key === 'Enter' && openProject(p.id)}>
              <div className="top">
                <span className="swatch" style={{ background: p.color }}>
                  <Icon name="folder" />
                </span>
                <h3 title={p.name}>{p.name}</h3>
                <button type="button" className="icon-btn" title="Modifier" onClick={(e) => { e.stopPropagation(); setEditing(p); }}>
                  <Icon name="edit" />
                </button>
                <button type="button" className="icon-btn" title="Supprimer" onClick={(e) => { e.stopPropagation(); void remove(p); }}>
                  <Icon name="trash" />
                </button>
              </div>
              <div className="progress-bar">
                <span style={{ width: `${ratio * 100}%`, background: p.color }} />
              </div>
              <div className="meta">
                <span>
                  {c.total - c.done} restante{c.total - c.done > 1 ? 's' : ''}
                </span>
                <span>
                  {c.done}/{c.total} · {Math.round(ratio * 100)} %
                </span>
              </div>
            </div>
          );
        })}
        <button type="button" className="card project-card new" onClick={() => setEditing('new')}>
          <Icon name="plus" size={20} />
          Nouveau projet
        </button>
      </div>
      {editing && <ProjectDialog project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
