import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as _ from 'lodash';
import * as kp from 'kill-port';
import * as cors from 'cors';

import { Block, getBlockchain, generateNextBlock, addBlockToChain } from './block';
import { getTransactionId, sendTransaction } from './transaction';
import { connectToPeers, getPods, initP2PServer } from './p2p';

const httpPort: number = parseInt(process.env.HTTP_PORT) || 3001;
const p2pPort: number = parseInt(process.env.P2P_PORT) || 6001;

const REGULAR_NODES = 0;
const PARTNER_NODES = 0;

const initHttpServer = (port: number) => {
  const app = express();
  app.use(bodyParser.json());
  app.use(cors());
  app.use((err, req, res, next) => {
    if (err) {
      res.status(400).send(err.message);
    }
  });

  app.get('/blocks', (req, res) => {
    res.send(getBlockchain());
  });

  app.get('/blocks', (req, res) => {
    res.send(getBlockchain());
  });

  app.post('/mineBlock', (req, res) => {
      const newBlock: Block = generateNextBlock(req.body.data);
      const result = addBlockToChain(newBlock);
      result ? res.send(newBlock) : res.send('Invalid Block');
  });


  app.get('/peers', (req, res) => {
      res.send(getPods().map(( p: any ) => {
        const returnObj = {
          name: p.name,
          location: p.location,
          address: `${p.ws._socket.remoteAddress} : ${p.ws._socket.remotePort}`
        };
        return returnObj;
      }));
  });

  app.post('/addPeer', (req, res) => {
      connectToPeers(req.body.peer);
      res.send();
  });

  app.listen(port, () => {
    console.log(`[Node] Listening on port: ${port}`);
  });
};

initHttpServer(httpPort);
initP2PServer(p2pPort);
