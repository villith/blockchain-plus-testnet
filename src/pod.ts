import * as io from 'socket.io-client';
import { Socket } from 'socket.io-client';
import * as WebSocket from 'ws';

class Pod {

  public id: number;
  public type: podType;
  public spawnTimestamp: number;
  public location: object;
  public ram: number;
  public storage: number;
  public uptime: number;
  public status: status;
  public name: string;
  public address: string;
  public ws: Socket;

  constructor(type: podType, location: object, name: string) {
    this.type = type;
    this.location = location;
    this.name = name;
  }
};

enum status {
  ONLINE = 2,
  BUSY = 1,
  OFFLINE = 0
}
enum podType {
  REGULAR_POD = 0,
  PARTNER_POD = 1
};

const regularPodSpecs = {
  ram: 2,
  storage: 100,
  uptime: 50
};

const partnerPodSpecs = {
  ram: 4,
  storage: 200,
  uptime: 99.97
};

const createPod = (type: podType, location: object, name: string) => {
  const pod: Pod = new Pod(type, location, name);
  io('http://localhost:3001');
  console.log('after io');
  pod.id = 0 // get num of pods + 1   OR   random string for id
  pod.spawnTimestamp = Math.round(new Date().getTime() / 1000);
  type === podType.REGULAR_POD ? Object.assign(pod, regularPodSpecs) : Object.assign(pod, partnerPodSpecs);
  pod.ram = gbToMb(pod.ram);
  pod.storage = gbToMb(pod.storage);
  pod.status = manageUptime(pod);
  connectToNetwork(pod);
  return pod;
};

const gbToMb = (gb: number) => {
  return gb * 1024;
};

const connectToNetwork = (pod: Pod): Socket => {
  io('http://localhost:6001');
};

const manageUptime = (pod: Pod): status => {
  const changeStatus = () => {
    const randomNumber = Math.random() * 100;
    if (randomNumber >= pod.uptime) {
      return status.OFFLINE;
    }
    return status.ONLINE;
  };

  setInterval(() => { return changeStatus(); }, 3600000);
  return changeStatus();
};

export { Pod, createPod };