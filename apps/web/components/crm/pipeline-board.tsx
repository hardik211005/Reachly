"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Announcements,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { CheckSquare, FileText, Plus } from "lucide-react";
import { DEAL_STAGE_LABELS, DEAL_STAGES, type DealStage } from "@repo/config";
import { Avatar, CompanyMark, Tooltip, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LostDialog, NewDealDialog, WonDialog, useInvalidateCrm } from "./deal-dialogs";
import { CHANNEL_ICON, DueText, QuoteStatusBadge, StageDot, daysSince, money, type DealCard, type PipelineData } from "./shared";

type Columns = Record<DealStage, string[]>;

function toColumns(deals: DealCard[]): Columns {
  const columns = Object.fromEntries(DEAL_STAGES.map((stage) => [stage, [] as string[]])) as unknown as Columns;
  for (const deal of deals) columns[deal.stage].push(deal.id);
  return columns;
}

function containerOf(columns: Columns, id: string): DealStage | null {
  if ((DEAL_STAGES as readonly string[]).includes(id)) return id as DealStage;
  return DEAL_STAGES.find((stage) => columns[stage].includes(id)) ?? null;
}

interface PendingMove {
  deal: DealCard;
  stage: DealStage;
  prevId: string | null;
  nextId: string | null;
  columns: Columns;
}

// ----------------------------------------------------------------------------- Card

function DealCardView({ deal, dragging, overlay }: { deal: DealCard; dragging?: boolean; overlay?: boolean }) {
  const closed = deal.stage === "WON" || deal.stage === "LOST";
  const ChannelIcon = deal.sourceChannel ? CHANNEL_ICON[deal.sourceChannel] : null;
  const days = daysSince(deal.stageChangedAt);
  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-surface p-3 text-left shadow-xs transition-[box-shadow,border-color,opacity]",
        "hover:border-border-strong",
        dragging && "opacity-40",
        overlay && "rotate-[1.5deg] cursor-grabbing border-border-strong shadow-lg",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyMark name={deal.lead.name} className="mt-0.5 size-7 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-5 font-semibold">{deal.lead.name}</p>
          {deal.title !== deal.lead.name ? <p className="truncate text-xs text-foreground-muted">{deal.title}</p> : <p className="truncate text-xs text-foreground-muted">{[deal.lead.locality, deal.lead.city].filter(Boolean).join(", ") || "—"}</p>}
        </div>
        {deal.owner ? (
          <Tooltip content={`Owner: ${deal.owner.name}`}>
            <span>
              <Avatar name={deal.owner.name} size="xs" />
            </span>
          </Tooltip>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className={cn("text-[15px] font-semibold tabular tracking-[-0.01em]", deal.value ? "text-foreground" : "text-foreground-subtle")}>{deal.value ? money(deal.value, deal.currency) : "No value"}</span>
        {!closed ? <span className="text-[11px] text-foreground-muted tabular">{deal.probability}%</span> : null}
      </div>

      {deal.stage === "LOST" && deal.lostReason ? <p className="mt-1 truncate text-[11px] text-danger-text">Lost: {deal.lostReason}</p> : null}

      {deal.quote || deal.nextTask ? (
        <div className="mt-2.5 grid gap-1.5 border-t border-border pt-2.5">
          {deal.quote ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <FileText className="size-3 shrink-0 text-foreground-subtle" />
              <span className="truncate text-foreground-secondary">{deal.quote.number}</span>
              <QuoteStatusBadge status={deal.quote.status} />
            </div>
          ) : null}
          {deal.nextTask && !closed ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <CheckSquare className="size-3 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate text-foreground-secondary">{deal.nextTask.title}</span>
              {deal.nextTask.dueAt ? <DueText value={deal.nextTask.dueAt} className="text-[11px]" /> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        {ChannelIcon ? <ChannelIcon className="size-3" aria-label={`From ${deal.sourceChannel?.toLowerCase().replace("_", " ")}`} /> : null}
        <span>{closed ? `${deal.stage === "WON" ? "Won" : "Lost"} ${days === 0 ? "today" : `${days}d ago`}` : days === 0 ? "Moved today" : `${days}d in stage`}</span>
      </div>
    </div>
  );
}

function SortableDeal({ deal, onOpen, disabled }: { deal: DealCard; onOpen: (id: string) => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable deal"
      aria-label={`${deal.lead.name}, ${money(deal.value, deal.currency)}, ${DEAL_STAGE_LABELS[deal.stage]}`}
      onClick={() => onOpen(deal.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented) onOpen(deal.id);
      }}
      className={cn("cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", disabled && "cursor-pointer")}
    >
      <DealCardView deal={deal} dragging={isDragging} />
    </li>
  );
}

// ----------------------------------------------------------------------------- Column

function Column({
  stage,
  deals,
  total,
  onOpen,
  onAdd,
  canWrite,
}: {
  stage: DealStage;
  deals: DealCard[];
  total: number;
  onOpen: (id: string) => void;
  onAdd: (stage: DealStage) => void;
  canWrite: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const closed = stage === "WON" || stage === "LOST";
  const currency = deals[0]?.currency ?? "INR";
  return (
    <section className="flex w-[272px] shrink-0 flex-col" aria-label={`${DEAL_STAGE_LABELS[stage]} column`}>
      <header className="mb-2 flex items-center gap-2 px-1">
        <StageDot stage={stage} />
        <h2 className="text-[13px] font-semibold">{DEAL_STAGE_LABELS[stage]}</h2>
        <span className="rounded-full bg-surface-sunken px-1.5 text-[11px] leading-[18px] font-medium text-foreground-muted tabular">{deals.length}</span>
        <span className="ml-auto text-[11px] text-foreground-muted tabular">{total ? money(total, currency, { compact: true }) : closed ? "Last 30 days" : ""}</span>
        {canWrite && !closed ? (
          <button type="button" onClick={() => onAdd(stage)} aria-label={`Add deal to ${DEAL_STAGE_LABELS[stage]}`} className="rounded-sm p-0.5 text-foreground-subtle hover:bg-surface-muted hover:text-foreground">
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </header>
      <SortableContext items={deals.map((deal) => deal.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            "flex min-h-28 flex-1 flex-col gap-2 rounded-xl border border-transparent bg-surface-sunken/60 p-2 transition-colors",
            isOver && "border-dashed border-border-strong bg-surface-sunken",
          )}
        >
          {deals.map((deal) => (
            <SortableDeal key={deal.id} deal={deal} onOpen={onOpen} disabled={!canWrite} />
          ))}
          {deals.length === 0 ? <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-6 text-center text-[11px] text-foreground-subtle">{canWrite ? "Drop a deal here" : "No deals"}</li> : null}
        </ul>
      </SortableContext>
    </section>
  );
}

// ----------------------------------------------------------------------------- Board

export function PipelineBoard({ data, queryKey, onOpen }: { data: PipelineData; queryKey: QueryKey; onOpen: (id: string) => void }) {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCrm();
  const [dragColumns, setDragColumns] = React.useState<Columns | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingMove | null>(null);
  const [adding, setAdding] = React.useState<DealStage | null>(null);
  // A drop is followed by a click on the card; don't open the deal for it.
  const lastDrop = React.useRef(0);
  const openDeal = (id: string) => {
    if (Date.now() - lastDrop.current > 250) onOpen(id);
  };

  const byId = React.useMemo(() => new Map(data.deals.map((deal) => [deal.id, deal])), [data.deals]);
  const columns = dragColumns ?? toColumns(data.deals);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }));

  const move = useMutation({
    mutationFn: (input: { id: string; stage: DealStage; prevId: string | null; nextId: string | null; lostReason?: string; value?: number }) =>
      api(`/api/v1/deals/${input.id}/move`, { method: "POST", json: { stage: input.stage, prevId: input.prevId, nextId: input.nextId, lostReason: input.lostReason, value: input.value } }),
    onSuccess: (_, input) => {
      if (input.stage === "WON") toast.success("Deal won — nice work");
      else if (input.stage === "LOST") toast("Deal marked lost");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidate(),
  });

  /** Shows the new order immediately, then saves it. */
  function commit(deal: DealCard, stage: DealStage, next: Columns, prevId: string | null, nextId: string | null, extra: { lostReason?: string; value?: number } = {}) {
    queryClient.setQueryData<PipelineData>(queryKey, (current) => {
      if (!current) return current;
      const lookup = new Map(current.deals.map((item) => [item.id, item]));
      const ordered = DEAL_STAGES.flatMap((column) =>
        next[column]
          .map((id) => lookup.get(id))
          .filter((item): item is DealCard => Boolean(item))
          .map((item) => (item.id === deal.id ? { ...item, stage, stageChangedAt: stage !== item.stage ? new Date().toISOString() : item.stageChangedAt, value: extra.value ?? item.value, lostReason: extra.lostReason ?? (stage === "LOST" ? item.lostReason : null) } : item)),
      );
      return { ...current, deals: ordered };
    });
    setDragColumns(null);
    move.mutate({ id: deal.id, stage, prevId, nextId, ...extra });
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDragColumns(toColumns(data.deals));
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    setDragColumns((current) => {
      const state = current ?? toColumns(data.deals);
      const from = containerOf(state, String(active.id));
      const to = containerOf(state, String(over.id));
      if (!from || !to || from === to) return current;
      const target = state[to].filter((id) => id !== active.id);
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex >= 0 ? overIndex : target.length;
      return { ...state, [from]: state[from].filter((id) => id !== active.id), [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)] };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    lastDrop.current = Date.now();
    const deal = byId.get(String(active.id));
    const state = dragColumns ?? toColumns(data.deals);
    if (!over || !deal) {
      setDragColumns(null);
      return;
    }
    const stage = containerOf(state, String(active.id));
    if (!stage) {
      setDragColumns(null);
      return;
    }
    let next = state;
    const overStage = containerOf(state, String(over.id));
    if (overStage === stage && over.id !== active.id && !(DEAL_STAGES as readonly string[]).includes(String(over.id))) {
      const list = state[stage];
      next = { ...state, [stage]: arrayMove(list, list.indexOf(String(active.id)), list.indexOf(String(over.id))) };
    }
    const list = next[stage];
    const index = list.indexOf(deal.id);
    const prevId = list[index - 1] ?? null;
    const nextId = list[index + 1] ?? null;
    const original = toColumns(data.deals)[deal.stage];
    const originalIndex = original.indexOf(deal.id);
    const unchanged = stage === deal.stage && (original[originalIndex - 1] ?? null) === prevId && (original[originalIndex + 1] ?? null) === nextId;
    if (unchanged) {
      setDragColumns(null);
      return;
    }
    if ((stage === "WON" || stage === "LOST") && stage !== deal.stage) {
      setDragColumns(next);
      setPending({ deal, stage, prevId, nextId, columns: next });
      return;
    }
    commit(deal, stage, next, prevId, nextId);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${byId.get(String(active.id))?.lead.name ?? "deal"}.`,
    onDragOver: ({ active, over }) => (over ? `${byId.get(String(active.id))?.lead.name ?? "Deal"} is over ${DEAL_STAGE_LABELS[containerOf(columns, String(over.id)) ?? "NEW"]}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${byId.get(String(active.id))?.lead.name ?? "deal"} in ${DEAL_STAGE_LABELS[containerOf(columns, String(over.id)) ?? "NEW"]}.` : "Move cancelled."),
    onDragCancel: () => "Move cancelled.",
  };

  const active = activeId ? byId.get(activeId) : null;
  const cancelPending = () => {
    setPending(null);
    setDragColumns(null);
  };

  return (
    <>
      <div className="-mx-1 min-w-0 overflow-x-auto px-1 pb-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDragColumns(null);
          }}
          accessibility={{ announcements }}
        >
          <div className="flex items-stretch gap-3">
            {DEAL_STAGES.map((stage) => {
              const deals = columns[stage].map((id) => byId.get(id)).filter((deal): deal is DealCard => Boolean(deal));
              return <Column key={stage} stage={stage} deals={deals} total={deals.reduce((sum, deal) => sum + deal.value, 0)} onOpen={openDeal} onAdd={setAdding} canWrite={canWrite} />;
            })}
          </div>
          <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>{active ? <DealCardView deal={active} overlay /> : null}</DragOverlay>
        </DndContext>
      </div>

      <WonDialog
        key={pending?.stage === "WON" ? pending.deal.id : "won"}
        deal={pending?.stage === "WON" ? pending.deal : null}
        pending={move.isPending}
        onCancel={cancelPending}
        onConfirm={(value) => {
          if (!pending) return;
          commit(pending.deal, "WON", pending.columns, pending.prevId, pending.nextId, { value });
          setPending(null);
        }}
      />
      <LostDialog
        key={pending?.stage === "LOST" ? pending.deal.id : "lost"}
        deal={pending?.stage === "LOST" ? pending.deal : null}
        pending={move.isPending}
        onCancel={cancelPending}
        onConfirm={(lostReason) => {
          if (!pending) return;
          commit(pending.deal, "LOST", pending.columns, pending.prevId, pending.nextId, { lostReason });
          setPending(null);
        }}
      />
      {adding ? <NewDealDialog key={adding} open onOpenChange={(open) => (open ? null : setAdding(null))} stage={adding} onCreated={onOpen} /> : null}
    </>
  );
}

export function PipelineSkeletonColumns() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {DEAL_STAGES.slice(0, 5).map((stage) => (
        <div key={stage} className="w-[272px] shrink-0">
          <div className="mb-2 h-5 w-24 animate-pulse rounded bg-surface-sunken" />
          <div className="grid gap-2 rounded-xl bg-surface-sunken/60 p-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

