interface PagerProps {
  total: number;
  page: number; // 0-based
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

const PAGE_SIZES = [50, 100, 250, 500, 1000];

/** Bottom strip: page navigation plus a rows-per-page selector. */
export default function Pager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div id="pager">
      <button onClick={() => onPage(0)} disabled={page === 0} title="First page">
        «
      </button>
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        title="Previous page"
      >
        ‹
      </button>
      <span>
        Page <b>{(page + 1).toLocaleString()}</b> of{" "}
        <b>{pages.toLocaleString()}</b>
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        title="Next page"
      >
        ›
      </button>
      <button
        onClick={() => onPage(pages - 1)}
        disabled={page >= pages - 1}
        title="Last page"
      >
        »
      </button>

      <span className="pager-spacer" />

      <span>
        Showing <b>{from.toLocaleString()}</b>–<b>{to.toLocaleString()}</b> of{" "}
        <b>{total.toLocaleString()}</b>
      </span>
      <label>
        Rows{" "}
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
