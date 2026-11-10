/**
 * Status singkat yang ditampilkan di sidebar dashboard.
 *
 * Diisi oleh `bot.ts` saat koneksi Discord siap. Kalau dashboard dijalankan
 * sendiri (`npm run dashboard`), status tetap "mode dashboard" — jadi user
 * tidak salah kira bot sedang online padahal hanya dashboard-nya yang hidup.
 */
export interface DashboardStatus {
  online: boolean;
  mode: 'bot' | 'standalone';
  uptimeSeconds: number;
}

let state: { online: boolean; mode: 'bot' | 'standalone' } = { online: false, mode: 'standalone' };

export function markBotOnline(online = true): void {
  state = { online, mode: 'bot' };
}

export function dashboardStatus(): DashboardStatus {
  return { ...state, uptimeSeconds: Math.round(process.uptime()) };
}
