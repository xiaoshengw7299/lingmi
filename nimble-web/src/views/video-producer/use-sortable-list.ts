import Sortable from 'sortablejs'
import { onBeforeUnmount, unref, watch, type MaybeRef, type Ref } from 'vue'

/** 在 CSS grid 卡片容器上启用拖拽排序；仅手柄可拖，避免误操作输入框与预览。 */
export function useSortableList(
  container: Ref<HTMLElement | undefined>,
  options: {
    disabled: MaybeRef<boolean>
    onReorder: (ids: string[]) => void | Promise<void>
    itemAttr?: string
    handle?: string
  },
) {
  let sortable: Sortable | null = null
  const itemAttr = options.itemAttr ?? 'data-id'

  function readIds(el: HTMLElement): string[] {
    return [...el.children]
      .map((node) => (node as HTMLElement).getAttribute(itemAttr))
      .filter((id): id is string => !!id)
  }

  function bind(el: HTMLElement | undefined) {
    sortable?.destroy()
    sortable = null
    if (!el) return
    sortable = Sortable.create(el, {
      animation: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      ghostClass: 'is-sortable-ghost',
      chosenClass: 'is-sortable-chosen',
      dragClass: 'is-sortable-drag',
      handle: options.handle ?? '.drag-handle',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      disabled: unref(options.disabled),
      onMove: () => !unref(options.disabled),
      onEnd(evt) {
        if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return
        void options.onReorder(readIds(el))
      },
    })
  }

  watch(container, (el) => bind(el), { immediate: true })
  watch(() => unref(options.disabled), (disabled) => sortable?.option('disabled', disabled))
  onBeforeUnmount(() => {
    sortable?.destroy()
    sortable = null
  })
}
