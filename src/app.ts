import * as bodyParser from 'body-parser';
import { spawn } from 'child_process';
import * as cors from 'cors';
// import * as dotenv from 'dotenv';
import * as express from 'express';
import * as http from 'http';
import * as minimist from 'minimist';

import { sendTestConfig, testStartMsg } from './message';
import { getIo, getPodIndexByPublicKey, getPods, initP2PNode, initP2PServer, killAll, wipeLedgers, write, getLogger } from './p2p';
import { Pod } from './pod';
import { selectRandom } from './rngTool';
import { TestConfig } from './testConfig';
import { randomNumberFromRange } from './utils';
import { getPublicFromWallet, initWallet } from './wallet';
import { LogEvent, EventType, createLogEventMsg } from './logEvent';

const config = require('../node/config/config.json');

// Argument Options
// * p = Port (number)
// * s = isSeed (boolean)
// * t = podType (podType)
// * c = isCluster (boolean)
// * np = numPartner (number)
// * nr = numRegular (number)
const argv = minimist(process.argv.slice(2));

// Arbitrary range
const portMin = 50000;
const portMax = 65535;

// Either a port is passed through the npm run command, or a random port is selected
// For non-local tests the port 80 is passed through npm run
const port = argv.p || randomNumberFromRange(portMin, portMax, true);

// For local testing a cluster is created
const localCluster = argv.c === 'true';
const numRegular = argv.nr || 0;
const numPartner = argv.np || 0;

/**
 * Initializes a http server with a limited API to allow for
 * user commands.
 * 
 * Commands: 
 * * getAddress
 * * killAll
 * * wipeLedgers
 * * getAddress
 */
const initHttpServer = (): void => {
  const app = express();
  const server = new http.Server(app);

  app.use(bodyParser.json());
  app.use(cors());
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      res.status(400).send(err.message);
    }
  });

  // app.post('/postTransaction', (req, res) => {
  //   const transaction = new Transaction(
  //     getPublicFromWallet(),
  //     req.body.transaction.to,
  //     req.body.transaction.amount,
  //     getCurrentTimestamp(),
  //   );

  //   requestValidateTransaction(transaction, getLocalLedger(LedgerType.MY_LEDGER));
  //   res.send(`${req.body.transaction.amount} sent to ${req.body.transaction.to}.`);
  // });

  app.get('/getAddress', (req, res) => {
    const address: string = getPublicFromWallet();
    res.send({ address });
  });

  // Kills all nodes connected to this server
  app.get('/killAll', (req, res) => {
    killAll();
    res.send('Killed all nodes');
  });

  // Wipes both ledgers.
  // TODO: Also wipe the wallet? Currently the genesis transaction isn't added to ledger again
  // because wallet already exists.
  app.get('/wipeLedgers', (req, res) => {
    wipeLedgers();
    res.send('Wiped all ledgers');
  });

  // Starts a test
  app.post('/startTest', (req, res) => {
    const { duration, numSenders, local, maxLedgerLength, senderAddresses } = req.body;
    const testConfig = new TestConfig(
      duration,
      numSenders,
      local,
      maxLedgerLength,
    );
    const pods: Pod[] = getPods();
    const io = getIo();
    const localLogger = getLogger();
    let selectedPods: Pod[] = [];
    if (req.body.senderAddresses > 0) {
      if (req.body.numSenders !== req.body.senderAddresses) {
        res.send('numSenders must equal the length of senderAddresses');
        return;
      }
      for (let i = 0; i < req.body.senderAddresses.length; i += 1) {
        const address = req.body.senderAddresses[i];
        const pod = pods[getPodIndexByPublicKey(address)];
        selectedPods.push(pod);
      }
    }
    else {
      const regularPods: Pod[] = pods.filter(pod => pod.type === 0);
      selectedPods = selectRandom(regularPods, testConfig.numSenders * 2, '');
    }
    console.log(localLogger);
    write(localLogger, testStartMsg());
    io.emit('message', sendTestConfig({ selectedPods, testConfig }));
    res.send('Test Started!');
  });

  server.listen(port, () => {
    // console.log(`[Node] New Node created on port: ${server.address().port}`);
    initWallet(server.address().port);
    initP2PServer(server);
    initP2PNode(server);
  });
};

if (localCluster) {
  for (let i = 0; i < numRegular; i += 1) {
    console.log('Spawning Regular node...');
    spawn('npm.cmd', ['run', 'start-regular-local']);
  }
  for (let i = 0; i < numPartner; i += 1) {
    console.log('Spawning Partner node...');
    spawn('npm.cmd', ['run', 'start-partner-local']);
  }
}
else {
  initHttpServer();
}
