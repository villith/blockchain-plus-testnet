import { getCurrentTimestamp, getLocalIp } from './utils';
import { getPublicFromWallet } from './wallet';

class Pod {
  public podType: PodType;
  public localIp: string;
  public spawnTimestamp: number;
  public address: string;
  public port: number;
  public ip: string;
  public socketId: string;
  public active: boolean;

  constructor(podType: PodType, port: number) {
    this.podType = podType;
    this.localIp = getLocalIp();
    this.address = getPublicFromWallet();
    this.spawnTimestamp = getCurrentTimestamp();
    this.port = port;
    this.ip = '';
    this.socketId = '';
    this.active = false;
  }
}

enum PodType {
  REGULAR_POD = 0,
  PARTNER_POD = 1,
  SEED_POD = 2,
  DUMMY_POD = 3,
}

export { Pod, PodType };
