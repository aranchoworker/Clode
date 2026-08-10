import { useCallback, useEffect, useRef, useState } from 'react';

type AsyncState<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
};

/**
 * 목록 화면에서 반복되는 "불러오기 / 로딩 / 에러 / 다시 불러오기"를 한 곳에 모은다.
 * 언마운트 후 setState 로 인한 경고를 막기 위해 mounted 플래그를 둔다.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await loader();
      if (mounted.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mounted.current) setState((prev) => ({ ...prev, error, loading: false }));
    }
    // loader 를 의존성에 넣으면 매 렌더마다 재실행된다. 호출부가 deps 를 명시하게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
