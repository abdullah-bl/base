let maintenanceMode = false
let maintenanceReason = 'Maintenance in progress'

export function isMaintenanceMode(): boolean {
  return maintenanceMode
}

export function setMaintenanceMode(enabled: boolean, reason?: string): void {
  maintenanceMode = enabled
  if (reason) maintenanceReason = reason
}

export function getMaintenanceReason(): string {
  return maintenanceReason
}
