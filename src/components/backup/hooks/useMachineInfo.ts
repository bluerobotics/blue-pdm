import { useState, useEffect } from 'react'
import { getMachineId, getMachineName, getPlatform } from '../../../lib/backup'

interface MachineInfo {
  machineId: string
  machineName: string
  machinePlatform: string
}

/**
 * Hook to load current machine information
 */
export function useMachineInfo(): MachineInfo {
  const [machineId, setMachineId] = useState<string>('')
  const [machineName, setMachineName] = useState<string>('This Machine')
  const [machinePlatform, setMachinePlatform] = useState<string>('')

  useEffect(() => {
    getMachineId().then(setMachineId)
    getMachineName().then(setMachineName)
    getPlatform().then(setMachinePlatform)
  }, [])

  return { machineId, machineName, machinePlatform }
}
