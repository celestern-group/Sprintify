// Kibo UI Table — vendored from https://www.kibo-ui.com/components/table.
//
// NOTE: `sortingAtom` is a module-level jotai atom, so every TableProvider in
// the app shares one sorting state. That is upstream's design and is fine while
// exactly one table uses it; a second concurrent table would need the atom
// scoped per provider.

import type {
  Cell,
  Column,
  ColumnDef,
  ColumnSizingState,
  Header,
  HeaderGroup,
  OnChangeFn,
  Row,
  SortingState,
  Table,
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { atom, useAtom } from "jotai";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type {
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import { createContext, useCallback, useContext } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TableBody as TableBodyRaw,
  TableCell as TableCellRaw,
  TableHeader as TableHeaderRaw,
  TableHead as TableHeadRaw,
  Table as TableRaw,
  TableRow as TableRowRaw,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type { ColumnDef } from "@tanstack/react-table";

const sortingAtom = atom<SortingState>([]);

export const TableContext = createContext<{
  data: unknown[];
  columns: ColumnDef<unknown, unknown>[];
  table: Table<unknown> | null;
}>({
  data: [],
  columns: [],
  table: null,
});

export type TableProviderProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Turns on the drag handle on every column that doesn't opt out. */
  enableColumnResizing?: boolean;
  /**
   * Widths, CONTROLLED. The backlog renders one table per sprint group and they
   * have to stay in the same grid, so the widths live above the provider rather
   * than in each table's own state — resizing one card resizes them all.
   */
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: OnChangeFn<ColumnSizingState>;
};

export function TableProvider<TData, TValue>({
  columns,
  data,
  children,
  className,
  style,
  enableColumnResizing = false,
  columnSizing,
  onColumnSizingChange,
}: TableProviderProps<TData, TValue>) {
  const [sorting, setSorting] = useAtom(sortingAtom);
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableColumnResizing,
    // `onChange` tracks the pointer live; `onEnd` would leave the header edge
    // lagging behind the cursor for the whole drag.
    columnResizeMode: "onChange",
    onSortingChange: (updater) => {
      // @ts-expect-error updater is a function that returns a sorting object
      const newSorting = updater(sorting);

      setSorting(newSorting);
    },
    onColumnSizingChange,
    state: {
      sorting,
      ...(columnSizing ? { columnSizing } : {}),
    },
  });

  // Dragging a handle otherwise selects the header text it passes over.
  const resizing = Boolean(table.getState().columnSizingInfo.isResizingColumn);

  return (
    <TableContext.Provider
      value={{
        data,
        columns: columns as never,
        table: table as never,
      }}
    >
      <TableRaw
        className={cn(className, resizing && "select-none")}
        style={style}
      >
        {/* Widths ride on a colgroup, not on the `th`. TanStack memoizes the
            header objects it hands out, and React Compiler memoizes the columns
            array they are built from, so a width that only lived on the header
            cell can stay on screen at its old value after the state behind it
            moved. The colgroup is rendered HERE, by the component the sizing
            state actually re-renders, and `table-fixed` gives it the last word
            on column width. */}
        {enableColumnResizing ? (
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col
                key={column.id}
                style={
                  column.getCanResize()
                    ? { width: column.getSize() }
                    : undefined
                }
              />
            ))}
          </colgroup>
        ) : null}
        {children}
      </TableRaw>
    </TableContext.Provider>
  );
}

/** How far one arrow-key press moves a column edge. */
const RESIZE_STEP = 16;

/**
 * The column edge you drag. Pointer-resizing is TanStack's own handler; the
 * keyboard path is ours, because a control that only answers a mouse fails the
 * a11y bar — arrows nudge, Home resets the column to its declared size.
 */
function ColumnResizeHandle({
  header,
  label,
}: {
  header: Header<unknown, unknown>;
  label: string;
}) {
  const { column } = header;
  const { table } = header.getContext();

  const nudge = (delta: number) => {
    const next = Math.min(
      column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER,
      Math.max(column.columnDef.minSize ?? 40, column.getSize() + delta),
    );
    table.setColumnSizing((current) => ({ ...current, [column.id]: next }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") nudge(-RESIZE_STEP);
    else if (event.key === "ArrowRight") nudge(RESIZE_STEP);
    else if (event.key === "Home") column.resetSize();
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      tabIndex={0}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => column.resetSize()}
      onKeyDown={onKeyDown}
      className={cn(
        // 14px of grab area, half of it spilling past the column edge: a
        // hairline you have to hit exactly is a control nobody can use.
        "absolute inset-y-0 right-0 z-10 w-3.5 translate-x-1/2 cursor-col-resize touch-none select-none",
        // The visible mark is the child, so the target stays fat while the rule
        // stays 2px. It shows on hover of the whole header cell, not only of
        // the 14px strip, so the edges announce themselves before you go
        // looking for them.
        "after:absolute after:inset-y-1 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent after:transition-colors",
        "group-hover/head:after:bg-border hover:after:bg-primary",
        "focus-visible:outline-none focus-visible:after:bg-primary",
        column.getIsResizing() && "after:bg-primary",
      )}
    />
  );
}

export type TableHeadProps = {
  header: Header<unknown, unknown>;
  className?: string;
  /**
   * The column's human title. The header itself is a render function, so the
   * resize handle can't read a label out of it for its `aria-label`.
   */
  label?: string;
};

// LOCAL: upstream wraps this in `memo`. A resizable header has to re-render
// while the column it belongs to is being dragged — the handle's own highlight
// is read off `column.getIsResizing()` — and its props (the memoized header
// object) don't change when that happens, so the memo would freeze it.
export const TableHead = ({ header, className, label }: TableHeadProps) => (
  <TableHeadRaw
    className={cn("group/head relative", className)}
    key={header.id}
  >
    {header.isPlaceholder
      ? null
      : flexRender(header.column.columnDef.header, header.getContext())}
    {header.column.getCanResize() ? (
      <ColumnResizeHandle header={header} label={label ?? header.column.id} />
    ) : null}
  </TableHeadRaw>
);

TableHead.displayName = "TableHead";

export type TableHeaderGroupProps = {
  headerGroup: HeaderGroup<unknown>;
  children: (props: { header: Header<unknown, unknown> }) => ReactNode;
};

export const TableHeaderGroup = ({
  headerGroup,
  children,
}: TableHeaderGroupProps) => (
  <TableRowRaw key={headerGroup.id}>
    {headerGroup.headers.map((header) => children({ header }))}
  </TableRowRaw>
);

export type TableHeaderProps = {
  className?: string;
  children: (props: { headerGroup: HeaderGroup<unknown> }) => ReactNode;
};

export const TableHeader = ({ className, children }: TableHeaderProps) => {
  const { table } = useContext(TableContext);

  return (
    <TableHeaderRaw className={className}>
      {table?.getHeaderGroups().map((headerGroup) => children({ headerGroup }))}
    </TableHeaderRaw>
  );
};

export interface TableColumnHeaderProps<TData, TValue>
  extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function TableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: TableColumnHeaderProps<TData, TValue>) {
  // Extract inline event handlers to prevent unnecessary re-renders
  const handleSortAsc = useCallback(() => {
    column.toggleSorting(false);
  }, [column]);

  const handleSortDesc = useCallback(() => {
    column.toggleSorting(true);
  }, [column]);

  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <DropdownMenu>
        {/* LOCAL: this project's DropdownMenu is Base UI, which composes with
            `render` rather than Radix's `asChild`. */}
        <DropdownMenuTrigger
          className="-ml-3 inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:text-foreground data-[popup-open]:bg-accent"
          nativeButton
        >
          <span>{title}</span>
          {column.getIsSorted() === "desc" ? (
            <ArrowDownIcon className="size-3.5" aria-hidden />
          ) : column.getIsSorted() === "asc" ? (
            <ArrowUpIcon className="size-3.5" aria-hidden />
          ) : (
            <ChevronsUpDownIcon className="size-3.5" aria-hidden />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={handleSortAsc}>
            <ArrowUpIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSortDesc}>
            <ArrowDownIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            Desc
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type TableCellProps = {
  cell: Cell<unknown, unknown>;
  className?: string;
};

export const TableCell = ({ cell, className }: TableCellProps) => (
  <TableCellRaw className={className}>
    {flexRender(cell.column.columnDef.cell, cell.getContext())}
  </TableCellRaw>
);

/**
 * LOCAL MODIFICATION: the row forwards any remaining `<tr>` props (and, in
 * React 19, its `ref`) to the element it renders.
 *
 * Upstream accepted `row`, `children` and `className` only, which meant a
 * caller could not attach anything to the row itself — and Base UI's
 * `ContextMenu.Trigger render={<TableRow …/>}` works by cloning the element
 * with an `onContextMenu` handler and a ref on it. Without the passthrough the
 * handler landed on a component that dropped it, and right-clicking a table row
 * did nothing at all.
 */
export type TableRowProps = Omit<ComponentProps<"tr">, "children"> & {
  row: Row<unknown>;
  children: (props: { cell: Cell<unknown, unknown> }) => ReactNode;
  className?: string;
};

export const TableRow = ({
  row,
  children,
  className,
  ...props
}: TableRowProps) => (
  <TableRowRaw
    className={className}
    data-state={row.getIsSelected() && "selected"}
    key={row.id}
    {...props}
  >
    {row.getVisibleCells().map((cell) => children({ cell }))}
  </TableRowRaw>
);

export type TableBodyProps = {
  children: (props: { row: Row<unknown> }) => ReactNode;
  className?: string;
};

export const TableBody = ({ children, className }: TableBodyProps) => {
  const { columns, table } = useContext(TableContext);
  const rows = table?.getRowModel().rows;

  return (
    <TableBodyRaw className={className}>
      {rows?.length ? (
        rows.map((row) => children({ row }))
      ) : (
        <TableRowRaw>
          <TableCellRaw className="h-24 text-center" colSpan={columns.length}>
            No results.
          </TableCellRaw>
        </TableRowRaw>
      )}
    </TableBodyRaw>
  );
};
