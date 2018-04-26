import * as WebSocket from 'ws';
import { Server } from 'ws';
import {
  addBlockToChain, Block, getBlockchain, getLastBlock, handleReceivedTransaction, isStructureValid, replaceChain
} from './block';
import { Pod, createPod } from './pod';
import { Transaction } from './transaction';
import { getTransactionPool } from './transactionPool';

const pods: Pod[] = [];

const randomNames = [
  "Jeevan Singh",
  "Jaswinder Singh",
  "Gabor Levai",
  "Rajah Vasjaragagag",
  "Scott Donnelly",
  "Gale Rott",
  "Carleen Labarge",
  "Mindy Rummage",
  "Malena Imhoff",
  "Layla Pfaff",
  "Ashleigh Depaoli",
  "Dimple Brockway",
  "Cheryl Mckie",
  "Voncile Rideout",
  "Nanette Skinner",
  "Wilburn Hetzel",
  "Zack Ganey",
  "Aleen Pilarski",
  "Johnson Cribbs",
  "Timothy Hottle",
  "Kellye Loney",
  "Iraida Browne",
  "Shaun Burton",
  "Brianne Honey",
  "Ceola Cantrelle",
  "Sheilah Thiede",
  "Antoine Osterberg",
  "Denese Bergin",
  "Stacia Zobel",
  "Trinity Meng",
  "Christiana Barnes",
  "Freddie Kin",
  "Kai Reid",
  "Marybeth Lavine",
  "Vella Sachs",
  "Cameron Abate",
  "Shawanna Emanuel",
  "Hilaria Gabourel",
  "Clelia Rohloff",
  "Joi Sandidge",
  "Micheal Belew",
  "Mercedes Buhler",
  "Tam Steimle",
  "Slyvia Alongi",
  "Suzie Mcneilly",
  "Stefanie Beehler",
  "Nadene Orcutt",
  "Maud Barlow",
  "Dusty Dabrowski",
  "Kylee Krom",
  "Lena Edmisten",
  "Kristopher Whiteside",
  "Dorine Lepley",
  "Kelle Khouri",
  "Cristen Shier"
];

enum MessageType {
  QUERY_LATEST = 0,
  QUERY_ALL = 1,
  RESPONSE_BLOCKCHAIN = 2,
  QUERY_TRANSACTION_POOL = 3,
  RESPONSE_TRANSACTION_POOL = 4,
  SELECTED_FOR_VALIDATION = 5
}

class Message {
  public type: MessageType;
  public data: any;
}

const initP2PServer = (p2pPort: number) => {
  const server: Server = new WebSocket.Server({ port: p2pPort });
  server.on('connection', (ws: WebSocket) => {
    initConnection(ws);
  });
  console.log('listening websocket p2p port on: ' + p2pPort);
};

const getPods = () => { return pods; };

const initConnection = (ws: WebSocket) => {
  const randomName = randomNames.splice(Math.floor(Math.random() * randomNames.length), 1)[0];
  const randomLocation = { x: Math.floor(Math.random() * 5000), y: Math.floor(Math.random() * 5000) };
  const randomType = Math.floor(Math.random() * 10) <= 1 ? 0 : 1;
  const pod: Pod = createPod(randomType);
  console.log(`Adding Pod... ${pod.name}`);
  pods.push(pod);
  initMessageHandler(pod);
  initErrorHandler(pod);
  write(pod, queryChainLengthMsg());
  setTimeout(() => {
    broadcast(queryTransactionPoolMsg());
  }, 500);
};

const JSONToObject = <T>(data: string): T => {
  try {
    return JSON.parse(data);
  } catch (e) {
    console.log(e);
    return null;
  }
};

const initMessageHandler = (pod: Pod) => {
  const { ws } = pod;
  ws.on('message', (data: string) => {
    try {
      const message: Message = JSONToObject<Message>(data);
      if (message === null) {
        console.log('could not parse received JSON message: ' + data);
        return;
      }
      console.log('Received message: %s', JSON.stringify(message));
      switch (message.type) {
        case MessageType.QUERY_LATEST:
          write(pod, responseLatestMsg());
          break;
        case MessageType.QUERY_ALL:
          write(pod, responseChainMsg());
          break;
        case MessageType.RESPONSE_BLOCKCHAIN:
          const receivedBlocks: Block[] = JSONToObject<Block[]>(message.data);
          if (receivedBlocks === null) {
            console.log('invalid blocks received: %s', JSON.stringify(message.data));
            break;
          }
          handleBlockchainResponse(receivedBlocks);
          break;
        case MessageType.QUERY_TRANSACTION_POOL:
          write(pod, responseTransactionPoolMsg());
          break;
        case MessageType.RESPONSE_TRANSACTION_POOL:
          const receivedTransactions: Transaction[] = JSONToObject<Transaction[]>(message.data);
          if (receivedTransactions === null) {
            console.log('invalid transaction received: %s', JSON.stringify(message.data));
            break;
          }
          receivedTransactions.forEach((transaction: Transaction) => {
            try {
              handleReceivedTransaction(transaction);
              // if no error is thrown, transaction was indeed added to the pool
              // let's broadcast transaction pool
              broadCastTransactionPool();
            } catch (e) {
              console.log(e.message);
            }
          });
          break;
      }
    } catch (e) {
      console.log(e);
    }
  });
};

const write = (pod: Pod, message: Message): void => {
  const { ws } = pod;
  ws.send(JSON.stringify(message));
};

const broadcast = (message: Message): void => pods.forEach((pod) => {
  write(pod, message);
});

const queryChainLengthMsg = (): Message => ({ 'type': MessageType.QUERY_LATEST, 'data': null });

const queryAllMsg = (): Message => ({ 'type': MessageType.QUERY_ALL, 'data': null });

const responseChainMsg = (): Message => ({
  'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(getBlockchain())
});

const responseLatestMsg = (): Message => ({
  'type': MessageType.RESPONSE_BLOCKCHAIN,
  'data': JSON.stringify([getLastBlock()])
});

const queryTransactionPoolMsg = (): Message => ({
  'type': MessageType.QUERY_TRANSACTION_POOL,
  'data': null
});

const responseTransactionPoolMsg = (): Message => ({
  'type': MessageType.RESPONSE_TRANSACTION_POOL,
  'data': JSON.stringify(getTransactionPool())
});

const initErrorHandler = (pod: Pod) => {
  const { ws } = pod;
  const closeConnection = (myPod: Pod) => {
    console.log('connection failed to peer: ' + myPod.ws.url);
    pods.splice(pods.indexOf(myPod), 1);
  };
  ws.on('close', () => closeConnection(pod));
  ws.on('error', () => closeConnection(pod));
};

const handleBlockchainResponse = (receivedBlocks: Block[]) => {
  if (receivedBlocks.length === 0) {
    console.log('received block chain size of 0');
    return;
  }
  const latestBlockReceived: Block = receivedBlocks[receivedBlocks.length - 1];
  if (!isStructureValid(latestBlockReceived)) {
    console.log('block structuture not valid');
    return;
  }
  const latestBlockHeld: Block = getLastBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log('blockchain possibly behind. We got: '
      + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
    if (latestBlockHeld.hash === latestBlockReceived.prevHash) {
      if (addBlockToChain(latestBlockReceived)) {
        broadcast(responseLatestMsg());
      }
    } else if (receivedBlocks.length === 1) {
      console.log('We have to query the chain from our peer');
      broadcast(queryAllMsg());
    } else {
      console.log('Received blockchain is longer than current blockchain');
      replaceChain(receivedBlocks);
    }
  } else {
    console.log('received blockchain is not longer than received blockchain. Do nothing');
  }
};

const broadcastLatest = (): void => {
  broadcast(responseLatestMsg());
};

const connectToPeers = (newPeer: string): void => {
  const ws: WebSocket = new WebSocket(newPeer);
  ws.on('open', () => {
    initConnection(ws);
  });
  ws.on('error', () => {
    console.log('connection failed');
  });
};

const broadCastTransactionPool = () => {
  broadcast(responseTransactionPoolMsg());
};

export { connectToPeers, broadcastLatest, broadCastTransactionPool, initP2PServer, getPods };