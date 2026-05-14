// 입력값을 일정 ms 지연 후 반영하는 디바운스 훅.
// 폼/검색창에서 매 키 입력마다 router push / API 호출이 발생하지 않도록 사용.

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
