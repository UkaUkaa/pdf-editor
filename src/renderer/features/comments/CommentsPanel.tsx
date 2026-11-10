import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import type { DocumentModel } from '@shared/types/document';
import { useUiStore } from '../../stores/uiStore';
import { deleteObjects } from '../pdf-editor/objectActions';
import { addReply, deleteReply, notesOf, revealNote, setNoteText, type NoteEntry } from './commentActions';

function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return '';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function NoteCard({ document, entry, selected }: { document: DocumentModel; entry: NoteEntry; selected: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { note, pageId, pageNumber } = entry;
  const [text, setText] = useState(note.text);
  const [reply, setReply] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const focusId = useUiStore((state) => state.focusNoteId);

  // Follow changes made elsewhere (undo, redo) while the field is not being typed in.
  useEffect(() => setText(note.text), [note.text]);
  useEffect(() => {
    if (focusId !== note.id) return;
    textRef.current?.focus();
    useUiStore.getState().setNoteFocus(null);
  }, [focusId, note.id]);

  return (
    <li className="comment" data-selected={selected || undefined} data-note-id={note.id}>
      <header className="comment__header">
        <button type="button" className="comment__meta" onClick={() => revealNote(document.id, entry)}>
          <span className="comment__author">{note.author || t('comments.anonymous')}</span>
          <span className="comment__date">
            {t('viewer.pageLabel', { number: pageNumber })}
            {formatDate(note.createdAt, i18n.language) && ` · ${formatDate(note.createdAt, i18n.language)}`}
          </span>
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          aria-label={t('comments.delete')}
          title={t('comments.delete')}
          onClick={() => deleteObjects(document.id, pageId, new Set([note.id]))}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </header>
      <textarea
        ref={textRef}
        className="comment__text"
        aria-label={t('comments.text')}
        placeholder={t('comments.placeholder')}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => setNoteText(document.id, pageId, note.id, text)}
      />
      {note.replies.length > 0 && (
        <ul className="comment__replies">
          {note.replies.map((item) => (
            <li key={item.id} className="comment__reply">
              <span className="comment__author">{item.author || t('comments.anonymous')}</span>
              <span className="comment__date">{formatDate(item.createdAt, i18n.language)}</span>
              <button
                type="button"
                className="icon-button icon-button--small"
                aria-label={t('comments.deleteReply')}
                title={t('comments.deleteReply')}
                onClick={() => deleteReply(document.id, pageId, note.id, item.id)}
              >
                <X size={12} aria-hidden />
              </button>
              <p className="comment__reply-text">{item.text}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="comment__reply-form"
        onSubmit={(event) => {
          event.preventDefault();
          addReply(document.id, pageId, note.id, reply);
          setReply('');
        }}
      >
        <input
          className="input"
          aria-label={t('comments.reply')}
          placeholder={t('comments.reply')}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
      </form>
    </li>
  );
}

/** All comments of the document with their replies. */
export function CommentsPanel({ document }: { document: DocumentModel }): React.JSX.Element {
  const { t } = useTranslation();
  const notes = notesOf(document);
  if (notes.length === 0) return <p className="panel__empty">{t('comments.empty')}</p>;
  return (
    <ul className="comments" aria-label={t('sidebar.tabs.comments')}>
      {notes.map((entry) => (
        <NoteCard key={entry.note.id} document={document} entry={entry} selected={document.selectedObjects.includes(entry.note.id)} />
      ))}
    </ul>
  );
}
