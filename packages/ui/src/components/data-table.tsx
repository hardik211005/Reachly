"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn, formatNumber } from "../lib/utils";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { Skeleton } from "./misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  /** Server-side pagination (page is 1-based). */
  pagination?: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  /** Keep showing previous rows at reduced opacity while refetching (no skeleton flash). */
  refetching?: boolean;
  empty?: React.ReactNode;
  className?: string;
  selectable?: boolean;
}

/**
 * Server-driven data table: sorting, pagination and selection state live in the parent
 * (usually synced to the URL) so the server does the heavy lifting.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  pagination,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  onRowClick,
  loading,
  refetching,
  empty,
  className,
  selectable = false,
}: DataTableProps<T>) {
  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: "__select",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: selectable,
    state: {
      sorting: sorting ?? [],
      rowSelection: rowSelection ?? {},
      columnVisibility: columnVisibility ?? {},
    },
    onSortingChange,
    onRowSelectionChange,
    onColumnVisibilityChange,
  });

  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const firstRow = pagination ? (pagination.page - 1) * pagination.pageSize + 1 : 1;
  const lastRow = pagination ? Math.min(pagination.total, pagination.page * pagination.pageSize) : data.length;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className={cn("transition-opacity duration-150", refetching && "opacity-60")}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort() && onSortingChange;
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} style={{ width: header.column.columnDef.size }}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                  {table.getVisibleFlatColumns().map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className="h-3.5 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleFlatColumns().length} className="h-auto p-0">
                  {empty ?? <div className="py-16 text-center text-foreground-muted">No results</div>}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && pagination.total > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-foreground-muted">
          <span className="tabular">
            {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(pagination.total)}
          </span>
          <div className="flex items-center gap-1">
            <span className="mr-2 tabular">
              Page {pagination.page} of {pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={pagination.page >= pageCount}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { ColumnDef, RowSelectionState, SortingState, VisibilityState };
