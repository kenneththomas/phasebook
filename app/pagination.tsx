import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        className="gray-button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={14} /> Previous
      </button>
      <span className="muted" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <button
        className="gray-button"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Next <ChevronRight size={14} />
      </button>
    </nav>
  );
}

export function pageRows<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  return {
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    pageCount,
    page: safePage,
  };
}
