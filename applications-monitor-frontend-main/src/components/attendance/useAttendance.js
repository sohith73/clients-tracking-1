import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/apiClient";
export function useAttendance(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/attendance/${path}`, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e);
      });
    return () => controller.abort();
  }, [path, version]);
  const mutate = async (url, body, method = "POST") => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch(`/api/attendance/${url}`, { method, body });
      setVersion((v) => v + 1);
      return result || true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { data, error, busy, mutate, refresh: () => setVersion((v) => v + 1) };
}
