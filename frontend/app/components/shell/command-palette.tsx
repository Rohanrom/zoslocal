'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from './icons';

export type Command = { id: string; label: string; group: string; href: string };

/** Ctrl K: jump to any hub, project or project view by typing. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  if (!open) return null;
  // Mounting fresh each time resets the query and selection.
  return <PaletteDialog onClose={onClose} commands={commands} />;
}

function PaletteDialog({ onClose, commands }: { onClose: () => void; commands: Command[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = words.length
      ? commands.filter((command) => {
          const text = `${command.group} ${command.label}`.toLowerCase();
          return words.every((word) => text.includes(word));
        })
      : commands;
    return matched.slice(0, 50);
  }, [commands, query]);

  const current = Math.min(selected, Math.max(results.length - 1, 0));

  function go(command: Command | undefined) {
    if (!command) return;
    onClose();
    router.push(command.href);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm">
      <button type="button" aria-label="Close search" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search ZOS"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 text-slate-400">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(results[current]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="zos-command-results"
            aria-activedescendant={results[current] ? `cmd-${results[current].id}` : undefined}
            aria-label="Search projects, modules and pages"
            placeholder="Go to a project, module or page"
            className="h-14 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-700 px-1.5 font-mono text-[11px] text-slate-500">Esc</kbd>
        </div>
        <ul id="zos-command-results" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={index === current}
              onMouseEnter={() => setSelected(index)}
              onClick={() => go(command)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm ${
                index === current ? 'bg-slate-800 text-white' : 'text-slate-300'
              }`}
            >
              <span className="truncate">{command.label}</span>
              <span className="shrink-0 text-xs text-slate-500">{command.group}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
