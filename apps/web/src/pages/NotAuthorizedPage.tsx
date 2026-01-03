import { useLocation, useNavigate } from "react-router-dom";

export default function NotAuthorizedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as Record<string, any> | null;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 600 }}>
      <div>
        <h1>Not Authorized</h1>
        <p>You do not have permission to access this resource.</p>

        {state?.requiredPerm && (
          <p style={{ fontSize: 14, color: "#666" }}>
            <strong>Required permission:</strong> {state.requiredPerm}
          </p>
        )}

        {state?.reason && (
          <p style={{ fontSize: 13, color: "#999" }}>
            Reason: {state.reason}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate("/")}>Home</button>
      </div>
    </div>
  );
}
