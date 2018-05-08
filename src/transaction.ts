import * as CryptoJS from 'crypto-js';
import * as ecdsa from 'elliptic';
import { Server } from 'socket.io';
import * as ioClient from 'socket.io-client';

import { Ledger } from './ledger';
import {
  getIo,
  getPodIndexByPublicKey,
  getPods,
  handleMessage,
  isTransactionHashValid,
  Message,
  MessageType,
  queryIsTransactionValid,
  write,
} from './p2p';
import { Pod } from './pod';
import { selectRandom } from './rngTool';
import { getCurrentTimestamp, getEntryByTransactionId, getEntryInLedgerByTransactionId } from './utils';
import { getPrivateFromWallet, getPublicFromWallet } from './wallet';

const ec = new ecdsa.ec('secp256k1');

class Transaction {
  public id: string;
  public from: string;
  public address: string;
  public amount: number;
  public witnessOne: string;
  public witnessTwo: string;
  public partnerOne: string;
  public partnerTwo: string;
  public signature: string;
  public timestamp: number;
  public hash: string;

  constructor(from: string, address: string, amount: number, timestamp: number) {
    this.from = from;
    this.address = address;
    this.amount = amount;
    this.timestamp = timestamp;
    // this.witnessOne = witnessOne;
    // this.witnessTwo = witnessTwo;
    // this.partnerOne = partnerOne;
    // this.partnerTwo = partnerTwo;
  }

  assignValidatorsToTransaction = (selectedPods: Pod[]): void => {
    this.witnessOne = selectedPods[0].address;
    this.witnessTwo = selectedPods[1].address;
    this.partnerOne = selectedPods[2].address;
    this.partnerTwo = selectedPods[3].address;
  }

  setTransactionId = (transactionId: string): void => {
    this.id = transactionId;
  }

  generateSignature = (): void => {
    const key = ec.keyFromPrivate(getPrivateFromWallet(), 'hex');
    this.signature = toHexString(key.sign(this.id).toDER());
  }

  generateHash = (): void => {
    this.hash = CryptoJS.SHA256(`
      ${this.witnessOne}
      ${this.witnessTwo}
      ${this.partnerOne}
      ${this.partnerTwo}
      ${this.address}
      ${this.amount}
      ${this.from}
      ${this.timestamp}
    `).toString();
  }
}

interface IResult {
  result: boolean;
  reason: string;
  id: string;
}

const genesisTimestamp: number = 1525278308842;
const genesisAddress: string = `04bfcab8722991ae774db48f934ca79cfb7dd991229153b9f732ba5334aafcd8e
  7266e47076996b55a14bf9913ee3145ce0cfc1372ada8ada74bd287450313534a`;
const genesisAmount: number = 50;
const getGenesisAddress = (): string => genesisAddress;

const genesisTransaction = (publicKey: string): Transaction => {
  const transaction = new Transaction(
    genesisAddress,
    publicKey,
    genesisAmount,
    genesisTimestamp,
  );

  transaction.setTransactionId(getTransactionId(transaction));
  transaction.generateSignature();
  transaction.generateHash();

  return transaction;
};

const getTransactionId = (transaction: Transaction): string => {
  // const lastSenderId: number = parseInt(''); // Last TransactionId in Sender's ledger
  // const lastreceiverId: number = parseInt(''); // Last TransactionId in receiver's ledger
  // const transactionId = `${lastSenderId + 1}-${lastreceiverId + 1}`;
  const { address, from, witnessOne, witnessTwo, partnerOne, partnerTwo } = transaction;
  return CryptoJS.SHA256(`
    ${witnessOne}
    ${witnessTwo}
    ${partnerOne}
    ${partnerTwo}
    ${address}
    ${from}
    ${getCurrentTimestamp()}
  `).toString();
};

const getExpectedTransactionId = (transaction: Transaction): string => {
  const { address, from, witnessOne, witnessTwo, partnerOne, partnerTwo, timestamp } = transaction;
  return CryptoJS.SHA256(`
    ${witnessOne}
    ${witnessTwo}
    ${partnerOne}
    ${partnerTwo}
    ${address}
    ${from}
    ${timestamp}
  `).toString();
};

const getPublicKey = (aPrivateKey: string): string => {
  return ec.keyFromPrivate(aPrivateKey, 'hex').getPublic().encode('hex');
};

const getCurrentHoldings = (ledger: Ledger, publicKey: string): number => {
  let currentHoldings = 0;
  for (let i = 0; i < ledger.entries.length; i += 1) {
    const entry = ledger.entries[i];
    // console.dir(entry);
    if (entry.address == publicKey) {
      console.log(`Address matches publicKey. Adding ${entry.amount} to currentHoldings.`);
      currentHoldings += entry.amount;
    }
    if (entry.from == publicKey) {
      console.log(`From matches publicKey. Removing ${entry.amount} from currentHoldings.`);
      currentHoldings -= entry.amount;
    }
  }
  return currentHoldings;
};

const requestValidateTransaction = (transaction: Transaction, senderLedger: Ledger): void => {
  const pods: Pod[] = getPods();
  // console.dir(pods);
  const regularPods: Pod[] = pods.filter(pod => pod.type === 0);
  const partnerPods: Pod[] = pods.filter(pod => pod.type === 1);
  const selectedPods: Pod[] = [...selectRandom(regularPods), ...selectRandom(partnerPods)];
  transaction.assignValidatorsToTransaction(selectedPods);
  transaction.setTransactionId(getTransactionId(transaction));
  transaction.generateSignature();

  const io: Server = getIo();
  console.log('Starting for loop for sending out validation checks...');
  for (let i = 0; i < selectedPods.length; i += 1) {
    const pod = selectedPods[i];
    console.log(`Connecting to ${pod.localIp}:${pod.port}`);
    const promise: Promise<void> = new Promise((resolve, reject) => {
      const socket = ioClient(`http://${pod.localIp}:${pod.port}`);
      socket.on('connect', () => {
        resolve(`Connected to ${pod.localIp}:${pod.port}... sending transaction details.`);
        write(socket, queryIsTransactionValid({ transaction, senderLedger }));
      });
      socket.on('message', (message: Message) => {
        handleMessage(socket, message);
      });
      socket.on('disconnect', () => {
        console.log('[requestValidateTransaction] socket disconnected.');
      });
      setTimeout(() => { reject(`Connection to ${pod.localIp}:${pod.port} could not be made in 10 seconds.`); }, 10000);
    }).then((fulfilled) => {
      console.log(fulfilled);
    },      (rejected) => {
      console.log(rejected);
    });
  }
};

const validateLedger = (senderLedger: Ledger, transaction: Transaction): Promise<IResult> => {
  const io: Server = getIo();
  const pods: Pod[] = getPods();
  const publicKey = transaction.from;
  if (senderLedger.entries.length === 1) {
    if (senderLedger.entries[0].from === getGenesisAddress()) {
      console.log('Initial genesis transaction for wallet. Skipping...');
      return new Promise((resolve, reject) => {
        if (transaction.amount < genesisAmount) {
          const result: IResult = {
            result: true,
            reason: '',
            id: null,
          };
          result.id = senderLedger.entries[0].id;
          resolve(result);
        } else {
          reject(
            `Insufficient funds in wallet.
             Current Holdings: ${genesisAmount}, Transaction Amount: ${transaction.amount}`);
        }
      });
    }
  }
  const promiseArray: Promise<IResult>[] = [];
  for (let i = 0; i < senderLedger.entries.length; i += 1) {
    console.log('Iterating over senderLedger.entries.');
    const entry: Transaction = senderLedger.entries[i];
    // console.dir(entry);
    const witnesses: string[] = [entry.witnessOne, entry.witnessTwo];
    const partners: string[] = [entry.partnerOne, entry.partnerTwo];
    const validators: string[] = [...witnesses, ...partners];
    const validatingPods: Pod[] = [];
    validators.map((v: string) => {
      console.log(v);
      const pod: Pod = pods[getPodIndexByPublicKey(v)];
      if (pod !== undefined) {
        console.log('Pushing validating pod to array');
        validatingPods.push(pod);
      }
      return;
    });
    for (let k = 0; k < validatingPods.length; k += 1) {
      console.log('Iterating over validating pods.');
      const pod = validatingPods[k];
      // console.dir(pod);
      const promise: Promise<IResult> = new Promise((resolve, reject) => {
        if (pod.address === getPublicFromWallet()) {
          console.log(`This node was a validator for this transaction.
           Checking hash against witness ledger entry...`);
          const result = validateTransactionHash(entry.id, entry.hash);
          resolve(result);
        } else {
          console.log(`Connecting to ${pod.localIp}:${pod.port}`);
          const socket = ioClient(`http://${pod.localIp}:${pod.port}`);
          const connectTimeout = setTimeout(() => {
            const result: IResult = {
              result: false,
              reason: `Connection to ${pod.localIp}:${pod.port} could not be made in 10 seconds.`,
              id: entry.id,
            };
            reject(result);
          }, 10000);
          socket.on('connect', () => {
            console.log(`Connected to ${pod.localIp}:${pod.port}... sending transaction details.`);
            clearTimeout(connectTimeout);
            write(socket, isTransactionHashValid({ transactionId: entry.id, hash: entry.hash }));
          });
          socket.on('disconnect', () => {
            console.log('Socket was disconnected.');
          });
          socket.on('message', (message: Message) => {
            console.log('[validateLedger] handleMessage');
            if (message.type === MessageType.TRANSACTION_CONFIRMATION_RESULT) {
              const result: IResult = handleMessage(socket, message);
              console.log(`Received validation result from ${pod.localIp}:${pod.port}...
               resolving promise.`);
              socket.disconnect();
              resolve(result);
            }
          });
        }
      });
      console.log('Adding promise to promiseArray...');
      promiseArray.push(promise);
    }
  }
  return Promise.all(promiseArray).then((results) => {
    console.log('All promises complete. Checking current holdings of sender...');
    const validationResult: IResult = {
      result: true,
      reason: '',
      id: transaction.id,
    };
    for (let j = 0; j < results.length; j += 1) {
      const result = results[j];
      if (!result.result) {
        validationResult.result = false;
        validationResult.reason = 'Needs to be filled with details of failed validation checks.';
      }
    }
    const currentHoldings = getCurrentHoldings(senderLedger, publicKey);
    if (currentHoldings < transaction.amount) {
      console.log(`Current Holdings: ${currentHoldings},
       Transaction Amount: ${transaction.amount}`);
      validationResult.result = false;
      validationResult.reason = `Insufficient funds in wallet.
       Current Holdings: ${currentHoldings}, Transaction Amount: ${transaction.amount}`;
    }
    if (validationResult.result) {
      validationResult.reason = 'Needs to be filled with details of validation checks.';
    }
    return validationResult;
  });
};

const validateTransaction = (transaction: Transaction, senderLedger: Ledger, callback): void => {
  const expectedTransactionId: string = getExpectedTransactionId(transaction);
  let result: IResult = { result: false, reason: '', id: transaction.id };
  if (expectedTransactionId !== transaction.id) {
    result.reason = `TransactionId is invalid.
     Expecting: ${expectedTransactionId}. Got: ${transaction.id}.`;
    console.log(result.reason);
    callback(result, transaction);
  } else {
    result = validateSignature(transaction); // Check if sender has proper access to funds
    if (!result.result) {
      console.log(result.reason);
      callback(result, transaction);
    }
    console.log('Signature was valid... validating ledger.');
    validateLedger(senderLedger, transaction).then((res) => {
      result = res;
      console.log('validateLedger result:');
      // console.dir(result);
      callback(result, transaction);
    });
  }
};

const validateSignature = (transaction: Transaction): IResult => {
  console.log('Validating signature...');
  const { id, from, signature }: { id: string, from: string, signature: string } = transaction;
  // console.log(`Validating signature.
  //  Parameters: { id: ${id}, from: ${from}, signature: ${signature} }`);
  const key = ec.keyFromPublic(from, 'hex');
  // console.log(`keyFromPublic: ${key}`);
  const result = key.verify(id, signature);
  const reason = 'Transaction signature is invalid.';
  return {
    result,
    reason,
    id,
  };
};

const generateSignature = (transaction: Transaction, privateKey: string): string => {
  const key = ec.keyFromPrivate(privateKey, 'hex');
  const signature: string = toHexString(key.sign(transaction.id).toDER());
  return signature;
};

const validateTransactionHash = (id: string, hash: string): IResult => {
  const transaction: Transaction = getEntryByTransactionId(id, 1);
  let result: boolean = false;
  let reason: string = 'Transaction hash is valid';
  if (!transaction) {
    result = false;
    reason = 'Transaction was not found in witnesses ledger';
  }
  if (transaction.hash === hash) {
    result = true;
  } else {
    reason = 'Transaction hash is invalid.';
  }
  return {
    result,
    reason,
    id,
  };
};

const toHexString = (byteArray): string => {
  return Array.from(byteArray, (byte: any) => {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
};

const isValidAddress = (address: string): boolean => {
  if (address.length !== 130) {
    console.log(`Invalid public key length. Expected 130, got: ${address.length}`);
  } else if (address.match('^[a-fA-F0-9]+$') === null) {
    console.log('public key must contain only hex characters');
    return false;
  } else if (!address.startsWith('04')) {
    console.log('public key must start with 04');
    return false;
  }
  return true;
};

export {
  Transaction, getTransactionId, IResult, requestValidateTransaction, genesisTransaction,
  getPublicKey, validateTransaction, validateTransactionHash, isValidAddress, getGenesisAddress,
};
