import { contextBridge, ipcRenderer } from 'electron';
import type { CueAPI, CueSnapshot, DirectorEvent } from '../../../packages/shared/index.ts';
const api: CueAPI = {
  getSetupStatus: () => ipcRenderer.invoke('cue:getSetupStatus'),
  setRememberConnections: (enabled) => ipcRenderer.invoke('cue:setRememberConnections', enabled),
  getSnapshot: () => ipcRenderer.invoke('cue:getSnapshot'),
  createPlan: (brief, mode) => ipcRenderer.invoke('cue:createPlan', brief, mode),
  savePlan: (plan) => ipcRenderer.invoke('cue:savePlan', plan),
  connectTwitch: () => ipcRenderer.invoke('cue:connectTwitch'),
  connectObs: (config) => ipcRenderer.invoke('cue:connectObs', config),
  checkReadiness: () => ipcRenderer.invoke('cue:checkReadiness'),
  applyMetadata: (id) => ipcRenderer.invoke('cue:applyMetadata', id),
  stageOverlay: () => ipcRenderer.invoke('cue:stageOverlay'),
  requestConfirmation: (operation) => ipcRenderer.invoke('cue:requestConfirmation', operation),
  startStream: (token) => ipcRenderer.invoke('cue:startStream', token),
  endStream: (token) => ipcRenderer.invoke('cue:endStream', token),
  pauseDirector: (paused) => ipcRenderer.invoke('cue:pauseDirector', paused),
  getRecap: (id) => ipcRenderer.invoke('cue:getRecap', id),
  updateSettings: (settings) => ipcRenderer.invoke('cue:updateSettings', settings),
  sendMessage: (text) => ipcRenderer.invoke('cue:sendMessage', text),
  injectDemo: () => ipcRenderer.invoke('cue:injectDemo'),
  deleteHistory: () => ipcRenderer.invoke('cue:deleteHistory'),
  disconnect: (service) => ipcRenderer.invoke('cue:disconnect', service),
  subscribeEvents: (listener) => {
    const handler = (_event: unknown, data: DirectorEvent) => listener(data);
    ipcRenderer.on('cue:event', handler);
    return () => {
      ipcRenderer.removeListener('cue:event', handler);
    };
  },
  onSnapshot: (listener) => {
    const handler = (_event: unknown, data: CueSnapshot) => listener(data);
    ipcRenderer.on('cue:snapshot', handler);
    return () => {
      ipcRenderer.removeListener('cue:snapshot', handler);
    };
  },
};
contextBridge.exposeInMainWorld('cue', api);
