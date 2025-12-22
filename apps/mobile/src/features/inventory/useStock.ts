import { useQuery } from "@tanstack/react-query";
import { fetchOnHand, fetchMovements, type OnHandResponse, type Movement } from "./stock";

export function useStock(itemId?: string) {
  const onhand = useQuery<OnHandResponse>({
    queryKey: ["inventory", "onhand", itemId],
    queryFn: () => fetchOnHand(itemId as string),
    enabled: !!itemId,
  });

  const movements = useQuery<Movement[]>({
    queryKey: ["inventory", "movements", itemId],
    queryFn: async () => {
      try {
        return await fetchMovements(itemId as string);
      } catch {
        // Endpoint may not exist yet; fall back silently
        return [];
      }
    },
    enabled: !!itemId,
  });

  const refetch = () => {
    void onhand.refetch();
    void movements.refetch();
  };

  return { 
    onhand, 
    movements: { 
      ...movements, 
      data: Array.isArray(movements.data) ? movements.data : [] 
    }, 
    refetch 
  };
}
