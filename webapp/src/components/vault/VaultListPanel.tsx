import type { JSX, RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useState } from 'preact/hooks';
import { Archive, ArrowUpDown, Check, CheckCheck, FolderInput, GripVertical, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-preact';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  defaultAnimateLayoutChanges,
  type AnimateLayoutChanges,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Cipher } from '@/lib/types';
import { t } from '@/lib/i18n';
import {
  CREATE_TYPE_OPTIONS,
  CreateTypeIcon,
  VAULT_SORT_OPTIONS,
  VaultListIcon,
  type SidebarFilter,
  type VaultSortMode,
} from '@/components/vault/vault-page-helpers';

interface VirtualRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

interface VaultListPanelProps {
  busy: boolean;
  loading: boolean;
  searchInput: string;
  sortMode: VaultSortMode;
  sortMenuOpen: boolean;
  selectedCount: number;
  totalCipherCount: number;
  filteredCiphers: Cipher[];
  visibleCiphers: Cipher[];
  virtualRange: VirtualRange;
  selectedCipherId: string;
  selectedMap: Record<string, boolean>;
  sidebarFilter: SidebarFilter;
  isMobileLayout: boolean;
  mobileFabVisible: boolean;
  canReorder: boolean;
  createMenuOpen: boolean;
  createMenuRef: RefObject<HTMLDivElement>;
  sortMenuRef: RefObject<HTMLDivElement>;
  listPanelRef: RefObject<HTMLDivElement>;
  onSearchInput: (value: string) => void;
  onClearSearch: () => void;
  onSearchCompositionStart: () => void;
  onSearchCompositionEnd: (value: string) => void;
  onToggleSortMenu: () => void;
  onSelectSortMode: (value: VaultSortMode) => void;
  onSyncVault: () => void;
  onOpenBulkDelete: () => void;
  onSelectDuplicates: () => void;
  onSelectAll: () => void;
  onToggleCreateMenu: () => void;
  onStartCreate: (type: number) => void;
  onBulkRestore: () => void;
  onBulkArchive: () => void;
  onBulkUnarchive: () => void;
  onOpenMove: () => void;
  onClearSelection: () => void;
  onReorderCipher: (activeId: string, overId: string) => void;
  onScroll: (top: number) => void;
  onToggleSelected: (cipherId: string, checked: boolean) => void;
  onSelectCipher: (cipherId: string) => void;
  listSubtitle: (cipher: Cipher) => string;
}

interface SortableCipherListItemProps {
  cipher: Cipher;
  selected: boolean;
  checked: boolean;
  canReorder: boolean;
  subtitle: string;
  onToggleSelected: (cipherId: string, checked: boolean) => void;
  onSelectCipher: (cipherId: string) => void;
}

interface CipherListItemBodyProps {
  cipher: Cipher;
  checked: boolean;
  canReorder: boolean;
  subtitle: string;
  dragButtonRef?: (element: HTMLButtonElement | null) => void;
  dragButtonAttributes?: JSX.HTMLAttributes<HTMLButtonElement>;
  dragButtonListeners?: Record<string, unknown>;
  onToggleSelected?: (cipherId: string, checked: boolean) => void;
  onSelectCipher?: (cipherId: string) => void;
}

function CipherListItemBody(props: CipherListItemBodyProps) {
  return (
    <>
      <input
        type="checkbox"
        className="row-check"
        checked={props.checked}
        disabled={!props.onToggleSelected}
        onClick={(event) => event.stopPropagation()}
        onInput={(e) => props.onToggleSelected?.(props.cipher.id, (e.currentTarget as HTMLInputElement).checked)}
      />
      <button type="button" className="row-main" disabled={!props.onSelectCipher} onClick={() => props.onSelectCipher?.(props.cipher.id)}>
        <div className="list-icon-wrap">
          <VaultListIcon cipher={props.cipher} />
        </div>
        <div className="list-text">
          <span className="list-title" title={props.cipher.decName || t('txt_no_name')}>
            <span className="list-title-text">{props.cipher.decName || t('txt_no_name')}</span>
          </span>
          <span className="list-sub" title={props.subtitle}>{props.subtitle}</span>
        </div>
      </button>
      <button
        type="button"
        ref={props.dragButtonRef}
        className="btn btn-secondary small cipher-drag-btn"
        title={t('txt_drag_to_reorder')}
        aria-label={t('txt_drag_to_reorder')}
        disabled={!props.canReorder}
        onClick={(event) => event.stopPropagation()}
        {...props.dragButtonAttributes}
        {...props.dragButtonListeners}
      >
        <GripVertical size={14} className="btn-icon" />
      </button>
    </>
  );
}

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting || args.wasDragging ? defaultAnimateLayoutChanges(args) : false;

function SortableCipherListItem(props: SortableCipherListItemProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.cipher.id,
    disabled: !props.canReorder,
    animateLayoutChanges,
  });
  const dragButtonAttributes = attributes as JSX.HTMLAttributes<HTMLButtonElement>;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`list-item ${props.selected ? 'active' : ''}${isDragging ? ' is-dragging is-sorting-source' : ''}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.row-check') || target.closest('.cipher-drag-btn')) return;
        props.onSelectCipher(props.cipher.id);
      }}
    >
      <CipherListItemBody
        cipher={props.cipher}
        checked={props.checked}
        canReorder={props.canReorder}
        subtitle={props.subtitle}
        dragButtonRef={setActivatorNodeRef}
        dragButtonAttributes={dragButtonAttributes}
        dragButtonListeners={listeners}
        onToggleSelected={props.onToggleSelected}
        onSelectCipher={props.onSelectCipher}
      />
    </div>
  );
}

export default function VaultListPanel(props: VaultListPanelProps) {
  const [activeDragId, setActiveDragId] = useState('');
  const [activeDragWidth, setActiveDragWidth] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 8,
      },
    })
  );

  const sortableItems = props.filteredCiphers.map((cipher) => cipher.id);
  const renderedCiphers = props.visibleCiphers;
  const activeDragCipher = activeDragId ? props.filteredCiphers.find((cipher) => cipher.id === activeDragId) || null : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setActiveDragWidth(event.active.rect.current.initial?.width || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    setActiveDragId('');
    setActiveDragWidth(null);
    if (!overId || activeId === overId) return;
    props.onReorderCipher(activeId, overId);
  };

  const handleDragCancel = () => {
    setActiveDragId('');
    setActiveDragWidth(null);
  };

  const createMenu = (
    <div className="create-menu-wrap mobile-fab-wrap" ref={props.createMenuRef}>
      <button
        type="button"
        className="btn btn-primary small mobile-fab-trigger"
        aria-label={t('txt_add')}
        title={t('txt_add')}
        onClick={props.onToggleCreateMenu}
      >
        <Plus size={14} className="btn-icon" />
      </button>
      {props.createMenuOpen && (
        <div className="create-menu">
          {CREATE_TYPE_OPTIONS.map((option) => (
            <button key={option.type} type="button" className="create-menu-item" onClick={() => props.onStartCreate(option.type)}>
              <CreateTypeIcon type={option.type} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="list-col">
      <div className="list-head">
        <div className="search-input-wrap">
          <input
            className="search-input"
            placeholder={t('txt_search_your_secure_vault')}
            value={props.searchInput}
            onInput={(e) => props.onSearchInput((e.currentTarget as HTMLInputElement).value)}
            onCompositionStart={props.onSearchCompositionStart}
            onCompositionEnd={(e) => props.onSearchCompositionEnd((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !props.searchInput) return;
              e.preventDefault();
              props.onClearSearch();
            }}
          />
          {!!props.searchInput && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label={t('txt_clear_search')}
              title={t('txt_clear_search_esc')}
              onClick={props.onClearSearch}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="sort-menu-wrap" ref={props.sortMenuRef}>
          <button
            type="button"
            className={`btn btn-secondary small sort-trigger ${props.sortMenuOpen ? 'active' : ''}`}
            aria-label={t('txt_sort')}
            title={t('txt_sort')}
            onClick={props.onToggleSortMenu}
          >
            <ArrowUpDown size={14} className="btn-icon" />
          </button>
          {props.sortMenuOpen && (
            <div className="sort-menu">
              {VAULT_SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sort-menu-item ${props.sortMode === option.value ? 'active' : ''}`}
                  onClick={() => props.onSelectSortMode(option.value)}
                >
                  <span>{option.label}</span>
                  {props.sortMode === option.value ? <Check size={14} /> : <span className="sort-menu-check-placeholder" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="list-count" title={t('txt_total_items_count', { count: props.totalCipherCount })}>
          {t('txt_total_items_count', { count: props.totalCipherCount })}
        </div>
        <button type="button" className="btn btn-secondary small list-icon-btn" disabled={props.busy || props.loading} onClick={props.onSyncVault}>
          <RefreshCw size={14} className="btn-icon" /> {t('txt_sync_vault')}
        </button>
      </div>
      <div className="toolbar actions">
        {props.sidebarFilter.kind === 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={!props.filteredCiphers.length || props.busy} onClick={props.onSelectDuplicates}>
            <Check size={14} className="btn-icon" /> {t('txt_select_duplicate_items')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind === 'trash' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkRestore}>
            <RefreshCw size={14} className="btn-icon" /> {t('txt_restore')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind === 'archive' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkUnarchive}>
            <RotateCcw size={14} className="btn-icon" /> {t('txt_unarchive')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind !== 'trash' && props.sidebarFilter.kind !== 'archive' && props.sidebarFilter.kind !== 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkArchive}>
            <Archive size={14} className="btn-icon" /> {t('txt_archive_selected')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind !== 'trash' && props.sidebarFilter.kind !== 'archive' && props.sidebarFilter.kind !== 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onOpenMove}>
            <FolderInput size={14} className="btn-icon" /> {t('txt_move')}
          </button>
        )}
        {props.selectedCount > 0 && (
          <button type="button" className="btn btn-secondary small" onClick={props.onClearSelection}>
            <X size={14} className="btn-icon" /> {t('txt_cancel')}
          </button>
        )}
        <button type="button" className="btn btn-danger small" disabled={!props.selectedCount || props.busy} onClick={props.onOpenBulkDelete}>
          <Trash2 size={14} className="btn-icon" /> {props.sidebarFilter.kind === 'trash' ? t('txt_delete_permanently') : t('txt_delete_selected')}
        </button>
        <button type="button" className="btn btn-secondary small" disabled={!props.filteredCiphers.length} onClick={props.onSelectAll}>
          <CheckCheck size={14} className="btn-icon" /> {t('txt_select_all')}
        </button>
        {props.isMobileLayout && typeof document !== 'undefined'
          ? props.mobileFabVisible ? createPortal(createMenu, document.body) : null
          : createMenu}
      </div>

      <div className="list-panel" ref={props.listPanelRef} onScroll={(event) => props.onScroll((event.currentTarget as HTMLDivElement).scrollTop)}>
        {!!props.filteredCiphers.length && (
          <div style={{ paddingTop: `${props.virtualRange.padTop}px`, paddingBottom: `${props.virtualRange.padBottom}px` }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
              <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
                {renderedCiphers.map((cipher) => (
                  <SortableCipherListItem
                    key={cipher.id}
                    cipher={cipher}
                    selected={props.selectedCipherId === cipher.id}
                    checked={!!props.selectedMap[cipher.id]}
                    canReorder={props.canReorder}
                    subtitle={props.listSubtitle(cipher)}
                    onToggleSelected={props.onToggleSelected}
                    onSelectCipher={props.onSelectCipher}
                  />
                ))}
              </SortableContext>
              <DragOverlay adjustScale={false}>
                {activeDragCipher ? (
                  <div className="list-item cipher-drag-overlay" style={activeDragWidth ? { width: `${activeDragWidth}px` } : undefined}>
                    <CipherListItemBody
                      cipher={activeDragCipher}
                      checked={!!props.selectedMap[activeDragCipher.id]}
                      canReorder={true}
                      subtitle={props.listSubtitle(activeDragCipher)}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}
        {!props.filteredCiphers.length && <div className="empty">{t('txt_no_items')}</div>}
      </div>
    </section>
  );
}
