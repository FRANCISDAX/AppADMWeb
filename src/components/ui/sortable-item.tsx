import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

type SortableItemProps = {
  id: string
  children: React.ReactNode
  editando?: boolean
  className?: string
}

export function SortableItem({ id, children, editando, className }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'ring-2 ring-primary/50 rounded-2xl',
        className
      )}
    >
      {editando && (
        <button
          {...attributes}
          {...listeners}
          className="absolute -left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow-md cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
      {children}
    </div>
  )
}
