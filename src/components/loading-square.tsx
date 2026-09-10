export function LoadingSquare() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="relative h-12 w-12">
        {/* 4 cuadros que se van armando */}
        <div className="absolute left-0 top-0 h-5 w-5 animate-[square1_2s_ease-in-out_infinite] rounded bg-orange-500 opacity-0" />
        <div className="absolute right-0 top-0 h-5 w-5 animate-[square2_2s_ease-in-out_infinite] rounded bg-orange-400 opacity-0" />
        <div className="absolute bottom-0 left-0 h-5 w-5 animate-[square3_2s_ease-in-out_infinite] rounded bg-orange-400 opacity-0" />
        <div className="absolute bottom-0 right-0 h-5 w-5 animate-[square4_2s_ease-in-out_infinite] rounded bg-orange-500 opacity-0" />
      </div>
    </div>
  )
}
