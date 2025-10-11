import { apiClient } from "../../api/client";

// Event registrations: cancel/checkin/checkout
export const registrations = {
  cancel:   (id: string) => apiClient.post(`/events/registration/${encodeURIComponent(id)}:cancel`,  {}),
  checkin:  (id: string) => apiClient.post(`/events/registration/${encodeURIComponent(id)}:checkin`, {}),
  checkout: (id: string) => apiClient.post(`/events/registration/${encodeURIComponent(id)}:checkout`, {}),
};
