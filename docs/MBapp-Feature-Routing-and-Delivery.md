
# MBapp-Feature-Routing-and-Delivery.md
*(Proposed for inclusion beginning Sprint B.2)*

---

## 🚚 Intelligent On-Property Routing and Delivery

### Vision
Enable **optimal delivery routing inside a controlled property** (stadiums, resorts, campuses, farms) for food, merchandise, or material distribution.  
Unlike public-road routing, this system optimizes travel **within private facilities** — hallways, service corridors, elevators, ramps, etc. — using our existing MBapp domains: **Parties, Resources, Events, and Orders**.

Think: *“Food-service runner at a stadium gets dynamic shortest paths avoiding crowds or closures.”*

---

## 🎯 Goals

- Provide real-time delivery routes for staff and resources across large venues.  
- Support both **static** (pre-event planning) and **dynamic** (live crowd, closure) routing.  
- Integrate with **Events**, **Orders**, **Parties**, and **Resources** modules.  
- Operate **offline or on private networks** (no dependency on public road APIs).  
- Provide a visual map and task navigation UI in the MBapp mobile client.

---

## 🧩 New Domain Entities

| Entity | Description |
|:-------|:-------------|
| **LocationNode** | A coordinate or logical node on property (e.g., “Kitchen A”, “Gate 12”, “Section 304 Bar”). |
| **PathEdge** | Connects two nodes with distance, slope, width, one-way rules, allowed modes. |
| **Zone** | Group of nodes/edges (e.g., “Main Concourse Level 300”) with crowd or access policies. |
| **Carrier** | A party or resource that performs deliveries (person, golf cart, van). Contains mode, capacity, and accessibility attributes. |
| **DeliveryTask** | A job: move items from a pickup node to a drop-off node with quantity, service time, time window, and priority. |
| **RoutePlan** | Result of a routing computation: ordered tasks, path (node IDs), ETA, total cost. |
| **CrowdSignal** | Real-time density sample for a zone (affects routing cost). |
| **Closure** | Temporary block or penalty on a node or edge (maintenance, security, event crowd). |

These extend the current **Objects API** model — each type can be stored as a normal MBapp object.

---

## ⚙️ Routing Model

### Graph Representation
- Nodes: `LocationNode`
- Edges: `PathEdge`
- Cost = `distance / speed(mode)` + penalties (access, slope, crowd, closure)

### Algorithms
| Problem | Technique |
|:---------|:-----------|
| Single route (A→B) | **A\*** search with mode-aware cost function |
| Multi-stop delivery | Simple **VRP (Vehicle Routing Problem)** heuristic (greedy + 2-opt) |
| Dynamic re-routing | Recompute when crowd/closure signals change or driver deviates |

---

## 🔗 Integration Points

| Existing Module | How It Connects |
|:-----------------|:----------------|
| **Parties** | Staff (role = runner, server, vendor) → Carrier |
| **Resources** | Carts, vehicles, doors, elevators; used for access rules and allowed modes |
| **Events** | Influence zone penalties (pre/post game crowds) and delivery windows |
| **Orders (SO/PO)** | Generate DeliveryTasks for goods/food fulfillment |
| **Inventory / Products** | Identify what is being moved and its weight/volume |

---

## 📱 Mobile Experience (Event Staff)

### Route View
- Map/schematic of the property with route overlay.
- Tasks list with ETAs, pickup/dropoff nodes.
- Dynamic re-route on closure/crowd updates.

### Modes
- **Foot**, **Cart**, or **Vehicle** (mode determines speed & allowed edges).
- **Accessibility toggle** for no-stairs routes.

### Offline Operation
- Graph stored locally with periodic sync.
- Routes recomputed client-side for robustness.

---

## 🖥️ Backend Endpoints

| Method & Path | Purpose |
|:---------------|:--------|
| `POST /routing/graph` | Upload or update property topology (nodes + edges). |
| `POST /routing/plan` | Request route or multi-task plan. |
| `POST /routing/replan/:id` | Recompute with new crowd/closure data. |
| `POST /routing/signals` | Ingest crowd or closure updates. |
| `GET  /routing/plan/:id` | Retrieve current route plan and ETAs. |

### Response Example
```json
{
  "id": "plan_123",
  "carrierId": "party_runner_17",
  "tasks": ["task_1","task_2"],
  "path": ["node_A","node_B","node_C"],
  "etaMinutes": 14.3,
  "totalCost": 102.5
}
```

---

## 🧠 Cost Function Example
```ts
cost = distance / speed(mode)
      + crowdPenalty(zoneId)
      + closurePenalty(edgeId)
      + slopePenalty(edge.slope, carrier.canStairs);
```

---

## 🧪 Planned Smoke Tests

| Test | Description | Expected Result |
|:-----|:-------------|:----------------|
| `smoke:routing:shortest` | Simple diamond graph; ensure A\* picks the shorter branch. | PASS (shortest path found) |
| `smoke:routing:closure` | Block shortest edge; verify alternate path used. | PASS |
| `smoke:routing:capacity` | Carrier capacity = 20 kg; task = 30 kg. | 422 (capacity violation) |
| `smoke:routing:timewindow` | Two tasks with overlapping time windows. | Second task delayed / infeasible flag |

---

## 🧭 Implementation Roadmap

### Sprint B.1 – Routing MVP
- Spec additions: `LocationNode`, `PathEdge`, `Carrier`, `DeliveryTask`
- Backend: `POST /routing/plan` (A\* single route)
- Mobile: Venue Map screen (show graph + route)
- Smoke: `smoke:routing:shortest`

### Sprint B.2 – Dynamic Routing and Signals
- Add `Closure`, `CrowdSignal`, `RoutePlan`
- Backend: VRP heuristic + replan logic
- Mobile: Task list + reroute UI (“Avoid Crowds” toggle)
- Smokes: `smoke:routing:closure`, `smoke:routing:capacity`

---

## 🧱 Structural Impact

| Layer | Change |
|:------|:--------|
| **Spec** | Adds routing entities to OpenAPI. |
| **Backend** | New `routing/` module; uses `Objects` for storage; integrates with Events & Orders. |
| **Mobile** | Adds “Venue Map” feature using same theming/hooks as existing modules. |
| **Infra** | No new AWS services required; stored in DynamoDB as Objects (`type: locationNode`, etc.). |
| **CI/Smokes** | Extend smoke suite with routing tests. |

---

## 📈 Expected Benefits

- Streamlines food/material distribution during large events.  
- Reduces staff transit time and congestion.  
- Increases visibility of resource usage and delivery efficiency.  
- Demonstrates MBapp’s capacity for **logistics intelligence** across physical venues.

---

### Next Steps
1. Approve concept for Sprint B.2.  
2. Add schemas to `MBapp-Modules.yaml`.  
3. Implement `routing/plan` endpoint and mobile Venue Map prototype.  
4. Introduce smoke tests for shortest-path and closure avoidance.  
5. Iterate toward multi-stop VRP with live signals.

---

*Prepared for inclusion in Tier 1 Roadmap → Sprint B.2 phase.*
