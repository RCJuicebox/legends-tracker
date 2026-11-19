import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

// How a zone's map is moved about (the Slayer and Hunter steps' SpawnMap, and the crawl route's map):
// the wheel zooms where the pointer is, a drag moves the map, a double click shows it whole again (LT-675).

/** An SVG viewBox: x, y, width, height. */
export type View = [number, number, number, number]

/** Zoomed in no further than this many times. */
const MAX_ZOOM = 12

export interface MapView {
  view: View
  svg: RefObject<SVGSVGElement | null>
  /** Zoomed in from the whole. */
  zoomed: boolean
  /** Shows the whole again. */
  reset: () => void
  /** The svg's pointer handlers. */
  on: {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onDoubleClick: () => void
  }
}

/** A map's view, starting at (and never wider than) the whole; a new whole starts it over. */
export function useMapView(whole: View): MapView {
  const [view, setView] = useState<View>(whole)
  useEffect(() => setView(whole), [whole])
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)
  // The wheel zooms about the pointer. Listened to by hand: React's wheel listener cannot stop the page scrolling.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      setView(([vx, vy, vw, vh]) => {
        const k = Math.exp(e.deltaY * 0.0015)
        const nw = Math.min(whole[2], Math.max(whole[2] / MAX_ZOOM, vw * k))
        const nh = (nw / vw) * vh
        const fx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
        const fy = rect.height ? (e.clientY - rect.top) / rect.height : 0.5
        return [vx + (vw - nw) * fx, vy + (vh - nh) * fy, nw, nh]
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [whole])
  const up = () => (drag.current = null)
  return {
    view,
    svg,
    zoomed: view[2] < whole[2] - 1e-6,
    reset: () => setView(whole),
    on: {
      onPointerDown: (e) => {
        if (e.button !== 0) return
        drag.current = { px: e.clientX, py: e.clientY, view }
        e.currentTarget.setPointerCapture?.(e.pointerId)
      },
      onPointerMove: (e) => {
        const d = drag.current
        const rect = svg.current?.getBoundingClientRect()
        if (!d || !rect?.width) return
        const scale = d.view[2] / rect.width
        setView([d.view[0] - (e.clientX - d.px) * scale, d.view[1] - (e.clientY - d.py) * scale, d.view[2], d.view[3]])
      },
      onPointerUp: up,
      onPointerCancel: up,
      onDoubleClick: () => setView(whole)
    }
  }
}
