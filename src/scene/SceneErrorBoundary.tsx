import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface SceneErrorBoundaryProps {
  children: ReactNode;
  navigationTargetId: string;
}

interface SceneErrorBoundaryState {
  failed: boolean;
}

/** Isolates WebGL failures while leaving the surrounding DOM archive operational. */
export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('3D scene rendering failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="scene-error-fallback" role="alert">
        <h2>3D 우주를 표시할 수 없습니다</h2>
        <p>작품 목록과 DOM 탐색에서 선택, 삭제, 블랙홀 이동 및 복원을 계속할 수 있습니다.</p>
        <div className="scene-error-actions">
          <a className="secondary-action" href={`#${this.props.navigationTargetId}`}>
            DOM 작품 탐색으로 이동
          </a>
          <button
            className="primary-action"
            onClick={() => this.setState({ failed: false })}
            type="button"
          >
            3D 우주 다시 시도
          </button>
        </div>
      </div>
    );
  }
}
