import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const TENANTS = [{ id: 'demo', name: 'Demo Tenant' }];
const DEVICES = [{ id: 'dev-001', tag: 'RFID-ABC123', tenantId: 'demo' }];

app.get('/', (_req, res) => res.json({ ok: true }));
app.get('/tenants', (_req, res) => res.json(TENANTS));
app.get('/devices', (req, res) => {
  const tenantId = req.query.tenantId || 'demo';
  res.json(DEVICES.filter(d => d.tenantId === tenantId));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`MBapp backend listening on ${port}`));
