export type VMStatus = 'provisioning' | 'starting' | 'running' | 'idle' | 'expired' | 'stopped';
export type Region = 'East US' | 'Central India';

export interface LabVM {
  id: string;
  userId: string;
  userName: string;
  labId: string;
  labName: string;
  region: Region;
  azureVmId: string;
  privateIp: string;
  status: VMStatus;
  vmSize: string;
  createdAt: string;
  expiresAt: string;
  idleMinutes: number;
}

export interface SessionMetric {
  id: string;
  userId: string;
  userName: string;
  vmId: string;
  startTime: string;
  endTime: string | null;
  idleMinutes: number;
  region: Region;
}

export interface RegionHealth {
  region: Region;
  status: 'healthy' | 'degraded' | 'down';
  aksNodes: number;
  aksPodsRunning: number;
  activeVMs: number;
  warmPoolVMs: number;
  redisCacheHitRate: number;
  avgProvisioningTime: number;
  activeConnections: number;
}

export const regionHealthData: RegionHealth[] = [
  {
    region: 'East US',
    status: 'healthy',
    aksNodes: 12,
    aksPodsRunning: 48,
    activeVMs: 342,
    warmPoolVMs: 58,
    redisCacheHitRate: 97.2,
    avgProvisioningTime: 45,
    activeConnections: 312,
  },
  {
    region: 'Central India',
    status: 'healthy',
    aksNodes: 8,
    aksPodsRunning: 32,
    activeVMs: 186,
    warmPoolVMs: 34,
    redisCacheHitRate: 95.8,
    avgProvisioningTime: 52,
    activeConnections: 171,
  },
];

const statuses: VMStatus[] = ['running', 'running', 'running', 'idle', 'provisioning', 'starting', 'expired', 'stopped'];
const labs = ['Azure Fundamentals', 'Kubernetes Lab', 'DevOps Pipeline', 'Security Workshop', 'Networking Lab'];
const vmSizes = ['Standard_B2s', 'Standard_B2ms', 'Standard_B4ms', 'Standard_D2s_v3'];
const names = ['Alice Chen', 'Bob Kumar', 'Carol Wang', 'Dave Patel', 'Eve Johnson', 'Frank Li', 'Grace Kim', 'Hank Müller', 'Iris Santos', 'Jack O\'Brien'];

export const labVMs: LabVM[] = Array.from({ length: 40 }, (_, i) => {
  const status = statuses[i % statuses.length];
  const region: Region = i % 3 === 0 ? 'Central India' : 'East US';
  return {
    id: `vm-${String(i + 1).padStart(3, '0')}`,
    userId: `user-${(i % 10) + 1}`,
    userName: names[i % 10],
    labId: `lab-${(i % 5) + 1}`,
    labName: labs[i % 5],
    region,
    azureVmId: `/subscriptions/.../vm-lab-${i + 1}`,
    privateIp: `10.${region === 'East US' ? 1 : 2}.${Math.floor(i / 255)}.${(i % 255) + 1}`,
    status,
    vmSize: vmSizes[i % vmSizes.length],
    createdAt: new Date(Date.now() - Math.random() * 3600000 * 4).toISOString(),
    expiresAt: new Date(Date.now() + Math.random() * 3600000 * 2).toISOString(),
    idleMinutes: status === 'idle' ? Math.floor(Math.random() * 18) + 2 : 0,
  };
});

export const sessionHistory = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  sessions: Math.floor(Math.random() * 300) + (i > 7 && i < 20 ? 200 : 50),
  vms: Math.floor(Math.random() * 250) + (i > 7 && i < 20 ? 150 : 30),
}));

export const costData = [
  { category: 'VM Compute', cost: 12450, percentage: 52 },
  { category: 'AKS Nodes', cost: 4800, percentage: 20 },
  { category: 'Redis Cache', cost: 2100, percentage: 9 },
  { category: 'MySQL', cost: 1800, percentage: 8 },
  { category: 'Networking', cost: 1500, percentage: 6 },
  { category: 'Storage', cost: 1200, percentage: 5 },
];

export const vmStatusCounts = {
  running: labVMs.filter(v => v.status === 'running').length,
  idle: labVMs.filter(v => v.status === 'idle').length,
  provisioning: labVMs.filter(v => v.status === 'provisioning').length,
  starting: labVMs.filter(v => v.status === 'starting').length,
  expired: labVMs.filter(v => v.status === 'expired').length,
  stopped: labVMs.filter(v => v.status === 'stopped').length,
};
