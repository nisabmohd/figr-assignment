// A region is one part of the screen that can fail on its own. It shows its error with a Retry button
// and leaves the rest of the app alone. It catches render errors; other errors arrive through raise().
import { Component, type ReactNode } from "react";
import { errorKey, raise, type Ctx } from "./failures";
import { update, useStore } from "./store";

type Props = { ctx: Ctx; error?: string; onRetry?: () => void; quiet?: boolean; children: ReactNode };

class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { raise(this.props.ctx, error); }
  componentDidUpdate() { if (this.state.failed && !this.props.error) this.setState({ failed: false }); } // after Retry
  render() {
    const { ctx, error, onRetry, quiet, children } = this.props;
    if (!this.state.failed && !error) return children;
    if (quiet) return null;
    return <ErrorBox message={error ?? "Something went wrong"} onRetry={() => { update((s) => { delete s.errors[errorKey(ctx)]; }); this.setState({ failed: false }); onRetry?.(); }} />;
  }
}

export function Region(props: Omit<Props, "error">) {
  const error = useStore((s) => s.errors[errorKey(props.ctx)]);
  return <Boundary {...props} error={error} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-box" role="alert">
      <div>{message}</div>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}
