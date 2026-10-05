import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

/** Last-resort boundary: logs the error and offers a reload instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Production error logging hook: forward to your monitoring endpoint here.
    console.error('[TANMIA] Unhandled UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const ar = document.documentElement.lang !== 'en';
    return (
      <div className="card" style={{ maxWidth: 560, margin: '12vh auto', padding: 20 }} role="alert">
        <h2>{ar ? 'حدث خطأ غير متوقع' : 'An unexpected error occurred'}</h2>
        <p className="muted small" style={{ margin: '8px 0 14px' }}>{ar ? 'تم تسجيل الخطأ. أعد تحميل الصفحة للمتابعة.' : 'The error was logged. Reload the page to continue.'}</p>
        <code className="small">{this.state.error.message}</code>
        <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => window.location.reload()}>{ar ? 'إعادة التحميل' : 'Reload'}</button></div>
      </div>
    );
  }
}
