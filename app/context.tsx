import { createContext, useContext } from 'react';
import type { World, Row } from './shared';
export type ModalState = {
  kind: string;
  row?: Row;
  onSaved?: (row: Row) => void;
} | null;
export type AppContextType = {
  world: World;
  me: Row;
  busy: boolean;
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
  const { person, go } = useApp();
  return (
    <button className="person-name" onClick={() => go('profile', id)}>
      {children || person(id)?.name || 'Unknown profile'}
    </button>
  );
}
