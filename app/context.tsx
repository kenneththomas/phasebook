import { createContext, useContext } from 'react';
import type { World, Row } from './shared';
export type ModalState = {
  kind: string;
  row?: Row;
  friendshipId?: string;
  ownerId?: string;
  albumId?: string;
  photoIds?: string[];
  onSaved?: (row: Row) => void;
} | null;
export type AppContextType = {
  world: World;
  me: Row;
  busy: boolean;
  error?: string;
  save: (table: string, row: Row) => Promise<boolean>;
  remove: (table: string, id: string) => Promise<boolean>;
  run: (path: string, value: unknown) => Promise<boolean>;
  go: (view: string, id?: string) => void;
  open: (modal: ModalState) => void;
  fail: (message: string) => void;
  person: (id: string) => Row;
  chat: (id: string) => void;
};
export const AppContext = createContext<AppContextType>(null!);
export const useApp = () => useContext(AppContext);
export function PersonLink({
  id,
  children,
}: {
  id: string;
  children?: React.ReactNode;
}) {
  const { person, go, open } = useApp();
  return (
    <button
      className="person-name"
      onClick={() => {
        open(null);
        go('profile', id);
      }}
    >
      {children || person(id)?.name || 'Unknown profile'}
    </button>
  );
}
