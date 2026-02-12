import React from "react";

type ErrorBoundaryProps = {
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

type ErrorBoundaryState = { hasError: boolean; message?: string };

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
      return (
        this.props.fallback || (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            Something went wrong in this section. {this.state.message}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
