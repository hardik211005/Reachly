"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { cn, formatNumber } from "../lib/utils";

/**
 * Chart layer. Conventions (from the data-viz method):
 *  - categorical colours by fixed slot order via SERIES_COLORS; never cycled past 8
 *  - 2px lines, ≥8px markers with a 2px surface ring, bars ≤24px with 4px rounded data-ends
 *  - hairline solid gridlines, recessive axes, text in text tokens (never the series colour)
 *  - legend for ≥2 series; every chart has a table-view twin (ChartCard toggle)
 */

export const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export const ORDINAL_RAMP = ["var(--seq-250)", "var(--seq-350)", "var(--seq-450)", "var(--seq-550)", "var(--seq-650)"] as const;

export interface SeriesDef {
  key: string;
  label: string;
  /** Categorical slot (0-based). Keep stable per entity so filters never repaint survivors. */
  slot?: number;
  color?: string;
}

function seriesColor(series: SeriesDef, index: number): string {
  return series.color ?? SERIES_COLORS[(series.slot ?? index) % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

type ValueFormatter = (value: number) => string;
const defaultFormat: ValueFormatter = (value) => formatNumber(value);

const axisProps = {
  stroke: "var(--baseline)",
  tick: { fill: "var(--foreground-muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

// ----------------------------------------------------------------------------- Tooltip

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  format: ValueFormatter;
  labelFormat?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-md border border-border bg-surface-raised px-2.5 py-2 text-xs shadow-md">
      {label !== undefined ? (
        <p className="mb-1.5 font-medium text-foreground">{labelFormat ? labelFormat(String(label)) : label}</p>
      ) : null}
      <div className="grid gap-1">
        {payload.map((item) => (
          <div key={String(item.dataKey ?? item.name)} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} aria-hidden />
            <span className="flex-1 text-foreground-secondary">{item.name}</span>
            <span className="font-medium text-foreground tabular">{typeof item.value === "number" ? format(item.value) : String(item.value ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Legend

export function ChartLegend({ items, className }: { items: Array<{ label: string; color: string }>; className?: string }) {
  if (items.length < 2) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-secondary", className)}>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------------------- ChartCard

export interface ChartTable {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}

export function ChartCard({
  title,
  description,
  actions,
  legend,
  table,
  children,
  className,
  empty,
  height = 240,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  legend?: Array<{ label: string; color: string }>;
  table?: ChartTable;
  children: React.ReactNode;
  className?: string;
  /** Rendered instead of the chart when there's no data. */
  empty?: React.ReactNode;
  height?: number;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  return (
    <section className={cn("flex flex-col rounded-lg border border-border bg-surface shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-foreground-muted">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && !empty ? (
            <button
              type="button"
              onClick={() => setView(view === "chart" ? "table" : "chart")}
              aria-label={view === "chart" ? "Show as table" : "Show as chart"}
              title={view === "chart" ? "Show as table" : "Show as chart"}
              className="rounded-sm p-1 text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
            </button>
          ) : null}
        </div>
      </header>
      {legend && !empty && view === "chart" ? <ChartLegend items={legend} className="px-4 pb-2" /> : null}
      <div className="px-2 pb-3" style={{ minHeight: height }}>
        {empty ? (
          <div className="flex items-center justify-center" style={{ height }}>
            {empty}
          </div>
        ) : view === "table" && table ? (
          <div className="max-h-[320px] overflow-auto px-2">
            <table className="w-full text-xs tabular">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  {table.columns.map((column) => (
                    <th key={column} className="py-1.5 pr-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border last:border-0">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={cn("py-1.5 pr-3", cellIndex > 0 && "text-foreground")}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- TimeSeriesChart

export function TimeSeriesChart({
  data,
  xKey,
  series,
  variant = "line",
  format = defaultFormat,
  xFormat,
  stacked = false,
}: {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: SeriesDef[];
  variant?: "line" | "area";
  format?: ValueFormatter;
  xFormat?: (value: string) => string;
  stacked?: boolean;
}) {
  const Chart = variant === "area" ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormat} minTickGap={24} dy={4} />
        <YAxis {...axisProps} width={44} tickFormatter={(value: number) => format(value)} allowDecimals={false} />
        <RechartsTooltip
          cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          content={<ChartTooltip format={format} labelFormat={xFormat} />}
        />
        {series.map((item, index) => {
          const color = seriesColor(item, index);
          return variant === "area" ? (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={color}
              strokeWidth={2}
              fill={color}
              fillOpacity={0.1}
              stackId={stacked ? "stack" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              isAnimationActive={false}
            />
          );
        })}
      </Chart>
    </ResponsiveContainer>
  );
}

// ----------------------------------------------------------------------------- BarChart

export function BarChart({
  data,
  categoryKey,
  series,
  layout = "vertical-bars",
  format = defaultFormat,
  stacked = false,
  categoryWidth = 110,
}: {
  data: Array<Record<string, string | number | null>>;
  categoryKey: string;
  series: SeriesDef[];
  /** vertical-bars = columns; horizontal-bars = bars growing right (better for long labels). */
  layout?: "vertical-bars" | "horizontal-bars";
  format?: ValueFormatter;
  stacked?: boolean;
  categoryWidth?: number;
}) {
  const horizontal = layout === "horizontal-bars";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsBarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="28%"
      >
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="var(--gridline)" strokeWidth={1} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(value: number) => format(value)} allowDecimals={false} />
            <YAxis type="category" dataKey={categoryKey} {...axisProps} width={categoryWidth} />
          </>
        ) : (
          <>
            <XAxis dataKey={categoryKey} {...axisProps} dy={4} interval={0} />
            <YAxis {...axisProps} width={44} tickFormatter={(value: number) => format(value)} allowDecimals={false} />
          </>
        )}
        <RechartsTooltip cursor={{ fill: "var(--surface-muted)" }} content={<ChartTooltip format={format} />} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={seriesColor(item, index)}
            maxBarSize={24}
            stackId={stacked ? "stack" : undefined}
            radius={stacked && index < series.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            stroke="var(--surface)"
            strokeWidth={stacked ? 2 : 0}
            isAnimationActive={false}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// ----------------------------------------------------------------------------- DonutChart

export function DonutChart({
  data,
  format = defaultFormat,
  centerLabel,
  centerValue,
}: {
  data: Array<{ label: string; value: number; slot?: number }>;
  format?: ValueFormatter;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="flex h-full items-center gap-4">
      <div className="relative h-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <RechartsTooltip content={<ChartTooltip format={format} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={data.length > 1 ? 1.5 : 0}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((item, index) => (
                <Cell key={item.label} fill={SERIES_COLORS[(item.slot ?? index) % SERIES_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold text-foreground">{centerValue}</span>
            {centerLabel ? <span className="text-[11px] text-foreground-muted">{centerLabel}</span> : null}
          </div>
        ) : null}
      </div>
      <ul className="grid min-w-32 gap-1.5 text-xs">
        {data.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: SERIES_COLORS[(item.slot ?? index) % SERIES_COLORS.length] }} aria-hidden />
            <span className="flex-1 truncate text-foreground-secondary">{item.label}</span>
            <span className="font-medium text-foreground tabular">{format(item.value)}</span>
            <span className="w-9 text-right text-foreground-muted tabular">{total ? `${Math.round((item.value / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------- FunnelChart

export function FunnelChart({ stages, format = defaultFormat }: { stages: Array<{ label: string; value: number }>; format?: ValueFormatter }) {
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  return (
    <ol className="grid gap-1.5 px-2">
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1]?.value : undefined;
        const conversion = previous ? stage.value / previous : null;
        const rampIndex = Math.min(ORDINAL_RAMP.length - 1, Math.floor((index / Math.max(1, stages.length - 1)) * (ORDINAL_RAMP.length - 1)));
        return (
          <li key={stage.label} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-xs">
            <span className="truncate text-foreground-secondary">{stage.label}</span>
            <div className="h-5 overflow-hidden rounded-[4px] bg-surface-sunken/60">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-500"
                style={{ width: `${Math.max(stage.value > 0 ? 1.5 : 0, (stage.value / max) * 100)}%`, background: ORDINAL_RAMP[rampIndex] }}
              />
            </div>
            <span className="flex w-24 items-baseline justify-end gap-2 tabular">
              <span className="font-medium text-foreground">{format(stage.value)}</span>
              <span className="w-10 text-right text-foreground-muted">
                {conversion === null ? "" : `${Math.round(conversion * 100)}%`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ----------------------------------------------------------------------------- Heatmap

export function Heatmap({
  rows,
  columns,
  values,
  format = defaultFormat,
}: {
  rows: string[];
  columns: string[];
  /** values[rowIndex][columnIndex] */
  values: number[][];
  format?: ValueFormatter;
}) {
  const max = Math.max(1, ...values.flat());
  const steps = ["var(--seq-100)", "var(--seq-200)", "var(--seq-350)", "var(--seq-450)", "var(--seq-550)", "var(--seq-650)"];
  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full border-separate border-spacing-[2px] text-[11px]">
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column} className="pb-1 font-normal text-foreground-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row}>
              <th className="pr-2 text-left font-normal whitespace-nowrap text-foreground-muted">{row}</th>
              {columns.map((column, columnIndex) => {
                const value = values[rowIndex]?.[columnIndex] ?? 0;
                const step = value === 0 ? null : steps[Math.min(steps.length - 1, Math.floor((value / max) * (steps.length - 1)))];
                return (
                  <td
                    key={column}
                    title={`${row} · ${column}: ${format(value)}`}
                    className="h-6 min-w-6 rounded-[3px]"
                    style={{ background: step ?? "var(--surface-muted)" }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-foreground-muted">
        <span>Less</span>
        {steps.map((step) => (
          <span key={step} className="size-2.5 rounded-[2px]" style={{ background: step }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Sparkline

export function Sparkline({ values, color = "var(--series-1)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const data = values.map((value, index) => ({ index, value }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
