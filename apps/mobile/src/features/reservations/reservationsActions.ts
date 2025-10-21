import { apiClient } from "../../api/client";

// Resource reservations: cancel/start/end
export const reservations = {
  cancel: (id: string) => apiClient.post(`/resources/reservation/${encodeURIComponent(id)}:cancel`, {}),
  start:  (id: string) => apiClient.post(`/resources/reservation/${encodeURIComponent(id)}:start`,  {}),
  end:    (id: string) => apiClient.post(`/resources/reservation/${encodeURIComponent(id)}:end`,   {}),
};
