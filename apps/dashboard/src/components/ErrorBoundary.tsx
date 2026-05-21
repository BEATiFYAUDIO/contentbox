import React from "react";

type ErrorBoundaryProps = {
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

type ErrorBoundaryState = { hasError: boolean; message?: string };

function looksLikeStaleChunkError(message: string | undefined) {
  return /dynamically imported module|loading chunk|chunkloaderror|importing a module script/i.test(String(message || ""));
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary", error);
  }

  render() {
    if (this.state.hasError) {
      const staleChunk = looksLikeStaleChunkError(this.state.message);
      return (
        this.props.fallback || (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <div>Something went wrong in this section. {this.state.message}</div>
            {staleChunk ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-red-800 px-3 py-1 text-xs text-red-100 hover:bg-red-900/40"
                onClick={() => window.location.reload()}
              >
                Reload dashboard
              </button>
            ) : null}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
