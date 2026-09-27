import { Component, type ErrorInfo, type ReactNode } from 'react'
import { api } from '../api'

// A page that throws while drawing shows what went wrong in its place, instead of a blank window; the
// sidebar and every other page keep working. The error also goes to the diagnostic log, since the
// main process logs a page's console errors.

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ what: string; children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.what} failed to draw: ${error.stack ?? error.message}${info.componentStack ?? ''}`)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="boot-error" role="alert">
        <h1>{this.props.what} hit an error</h1>
        <p>{error.message}</p>
        <p className="muted small">The rest of the app is fine. Try again, or pick another page; the log folder has the details for a bug report.</p>
        <div className="row">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={() => void api.invoke('app:openLogs').catch(() => {})}>
            Open log folder
          </button>
        </div>
      </div>
    )
  }
}
